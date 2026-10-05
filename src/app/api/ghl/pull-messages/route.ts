import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { requireUser } from "@/lib/serverAuth";
import { configuredLocations, tokenForLocation } from "@/lib/ghlTokens";
import { createLocator } from "@/lib/ghlLocate";
import { pullContactConversations, pullStrangerConversation, ghlUsersToMembers, ghlConversationRow, strangerNeedsPull, withLocalAssign } from "@/lib/ghlPull";
import { resolveTrackedClientId } from "@/lib/ghlConversationTask";
import { isRealGhlId } from "@/lib/ghlMatch";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The 15 minute GoHighLevel pull (Derek, 2026-09-30: GoHighLevel is the record
// of every client communication). Runs 7 minutes after each Gmail poll, so
// the email that poll stored is there to be confirmed. Two kinds of contact
// are pulled:
//
// 1. Every contact whose GoHighLevel conversation had a message in the window,
//    per connected sub-account. This is the only way a text or call reaches
//    the app now that no webhook workflow runs: a list built from local
//    messages can never find a message the app has not seen.
// 2. Every contact with a local email, text or call in the window that
//    GoHighLevel has not confirmed yet, whose sub-account is found by asking
//    each token (lib/ghlLocate).
//
// Each goes through lib/ghlPull, which stamps GoHighLevel ids on the rows it
// pairs, stores what is new, and raises reply tasks for unanswered texts and
// missed calls.
//
// Trigger: Vercel cron (vercel.json), or an admin, who may POST { days } (up
// to 30) to catch up once.
//
// Quick: the Inbox's ↻ (Derek, 2026-10-05: "I want to pull them in faster")
// POSTs { quick: true } as any signed-in teammate. It reads only the
// conversations that changed in the last 45 minutes, one page per
// sub-account, and stops after about 25 seconds. At most one runs every 20
// seconds per server.
export const maxDuration = 120;

const DAY = 24 * 60 * 60 * 1000;
const API = "https://services.leadconnectorhq.com";

export async function GET(req: NextRequest) {
  return run(req, 2);
}
let lastQuick = 0;
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  if (body?.quick === true) {
    if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
    if (!(await requireUser(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (Date.now() - lastQuick < 20_000) return NextResponse.json({ ok: true, skipped: "just checked" });
    lastQuick = Date.now();
    return run(req, 2, true);
  }
  const days = typeof body?.days === "number" && body.days > 0 ? Math.min(Math.floor(body.days), 30) : 2;
  return run(req, days);
}

async function run(req: NextRequest, days: number, quick = false) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!quick && !(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const sinceMs = quick ? started - 45 * 60_000 : started - days * DAY;
  // How long this run may take before it stops and answers.
  const budgetMs = quick ? 25_000 : (maxDuration - 40) * 1000;
  const errors: string[] = [];
  const rejectedTokens: string[] = [];
  // ghl contact id → location it was found in.
  const work = new Map<string, string>();
  // Every recent conversation, for the Inbox: who it is assigned to, and the
  // ones whose person is not a contact yet (pulled on their own below).
  const convRows: ReturnType<typeof ghlConversationRow>[] = [];
  const convsByContact = new Map<string, { conv: any; token: string }[]>();
  const { data: team } = await supabaseAdmin.from("profiles").select("email, member_id, ghl_user_id");
  const memberByEmail = new Map<string, string>();
  for (const p of team ?? []) if (p.email && p.member_id) memberByEmail.set(String(p.email).toLowerCase(), p.member_id as string);

  // Each teammate's GoHighLevel user id, as GoHighLevel itself lists it.
  const ghlIdsByMember = new Map<string, Set<string>>();
  // 1. Recent conversations, newest first, per sub-account.
  for (const locationId of await configuredLocations()) {
    const token = await tokenForLocation(locationId);
    if (!token) continue;
    const headers = { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" };
    const members = await ghlUsersToMembers(locationId, token, memberByEmail);
    for (const [ghlId, member] of members) ghlIdsByMember.set(member, new Set([...(ghlIdsByMember.get(member) ?? []), ghlId]));
    let startAfterDate: number | undefined;
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ locationId, sortBy: "last_message_date", sort: "desc", limit: quick ? "30" : "100" });
      if (startAfterDate) q.set("startAfterDate", String(startAfterDate));
      let res: Response;
      try {
        res = await fetch(`${API}/conversations/search?${q}`, { headers, signal: AbortSignal.timeout(15000) });
      } catch (e) {
        errors.push(`${locationId}: ${e instanceof Error ? e.message : "search failed"}`);
        break;
      }
      if (res.status === 401) { rejectedTokens.push(locationId); break; }
      if (!res.ok) { errors.push(`${locationId}: search ${res.status}`); break; }
      const convs: any[] = (await res.json())?.conversations ?? [];
      let reachedOld = false;
      for (const c of convs) {
        const last = Number(c?.lastMessageDate);
        if (!Number.isFinite(last) || last < sinceMs) { reachedOld = true; continue; }
        if (c?.contactId && !work.has(c.contactId)) work.set(c.contactId, locationId);
        if (c?.id) {
          convRows.push(ghlConversationRow(c, locationId, members));
          if (c?.contactId) convsByContact.set(c.contactId, [...(convsByContact.get(c.contactId) ?? []), { conv: c, token }]);
        }
      }
      if (quick || reachedOld || convs.length < 100) break;
      startAfterDate = Number(convs[convs.length - 1]?.lastMessageDate) || undefined;
      if (!startAfterDate) break;
    }
  }

  // Settings, Team keeps each teammate's GoHighLevel user id, which Assign and
  // sending under your own name need. Filled from GoHighLevel's user list
  // (matched by email) when it is blank or not one GoHighLevel knows, so a
  // mistyped id fixes itself (Derek's had a lowercase L for a capital I).
  let ghlIdsFixed = 0;
  for (const p of quick ? [] : team ?? []) {
    const ids = p.member_id ? ghlIdsByMember.get(p.member_id as string) : undefined;
    if (!ids?.size || ids.has(((p.ghl_user_id as string | null) ?? "").trim())) continue;
    const { error } = await supabaseAdmin.from("profiles").update({ ghl_user_id: [...ids][0] }).eq("member_id", p.member_id);
    if (!error) ghlIdsFixed++;
  }

  // 2. Local messages GoHighLevel has not confirmed yet.
  const { data: pendingRows } = quick ? { data: [] as any[] } : await supabaseAdmin
    .from("messages").select("contact_id, ghl_message_id")
    .in("channel", ["email", "sms", "call"])
    .gte("created_at", new Date(sinceMs).toISOString())
    .not("contact_id", "is", null)
    .limit(5000);
  const pendingContactIds = [...new Set((pendingRows ?? []).filter((r: any) => !isRealGhlId(r.ghl_message_id)).map((r: any) => r.contact_id as string))];

  // Both lists as local contacts.
  const byGhl = new Map<string, { id: string; client_id: string; ghl_contact_id: string }>();
  const ghlIds = [...work.keys()];
  for (let i = 0; i < ghlIds.length; i += 200) {
    const { data } = await supabaseAdmin.from("contacts").select("id, client_id, ghl_contact_id").in("ghl_contact_id", ghlIds.slice(i, i + 200));
    for (const c of data ?? []) if (!byGhl.has(c.ghl_contact_id as string)) byGhl.set(c.ghl_contact_id as string, c as any);
  }
  const unknownInGhl = ghlIds.filter((g) => !byGhl.has(g)).length;
  let noGhlId = 0, notFound = 0;
  if (pendingContactIds.length) {
    const { data } = await supabaseAdmin.from("contacts").select("id, client_id, ghl_contact_id").in("id", pendingContactIds);
    const { locationForContact } = createLocator();
    for (const c of data ?? []) {
      const g = c.ghl_contact_id as string | null;
      if (!g) { noGhlId++; continue; }
      if (work.has(g)) continue;
      const loc = await locationForContact(g);
      if (!loc) { notFound++; continue; }
      work.set(g, loc);
      byGhl.set(g, c as any);
    }
  }

  // Who each conversation belongs to, for the Inbox. One someone assigned in
  // the Inbox keeps that until GoHighLevel shows a change of its own.
  let toSave: Record<string, unknown>[] = convRows;
  for (let i = 0; i < convRows.length; i += 200) {
    const slice = convRows.slice(i, i + 200);
    const { data: marked, error: markErr } = await supabaseAdmin.from("ghl_conversations")
      .select("id, local_assign_from, assigned_ghl_user_id, assigned_member_id")
      .in("id", slice.map((r) => r.id)).not("local_assign_from", "is", null);
    // Before supabase/inbox-audit.sql the column is missing: save as before.
    if (markErr) { toSave = convRows; break; }
    if (i === 0) toSave = [];
    const byId = new Map(((marked ?? []) as any[]).map((r) => [r.id as string, r]));
    toSave.push(...slice.map((r) => withLocalAssign(r, byId.get(r.id))));
  }
  for (let i = 0; i < toSave.length; i += 200) {
    const { error } = await supabaseAdmin.from("ghl_conversations").upsert(toSave.slice(i, i + 200), { onConflict: "id" });
    if (error) { errors.push(`conversations: ${error.message}`); break; }
  }

  let contacts = 0, stamped = 0, inserted = 0, tasksRaised = 0, held = 0, left = 0, strangers = 0, strangersSkipped = 0;
  // Known contacts first: a client's text matters more than a Facebook lead,
  // and the strangers get whatever time is left.
  for (const [ghlContactId, locationId] of work) {
    const c = byGhl.get(ghlContactId);
    if (!c) continue;
    // Leave room to answer before Vercel cuts the run off; the next run
    // picks up whoever was left.
    if (Date.now() - started > budgetMs) { left++; continue; }
    try {
      const clientId = await resolveTrackedClientId(c.id, c.client_id);
      const r = await pullContactConversations({ contactId: c.id, clientId, locationId, ghlContactId, sinceMs, raiseTasks: true });
      contacts++;
      stamped += r.stamped; inserted += r.inserted; tasksRaised += r.tasksRaised; held += r.held;
    } catch (e) {
      errors.push(`${c.id}: ${e instanceof Error ? e.message : "pull failed"}`);
    }
  }

  // People who are not contacts yet: their conversations go to the Inbox
  // only. One already stored up to its newest message is not read again.
  const strangerConvs = ghlIds.filter((g) => !byGhl.has(g)).flatMap((g) => convsByContact.get(g) ?? []);
  const newestStored = new Map<string, number>();
  const strangerIds = strangerConvs.map(({ conv }) => conv.id as string);
  for (let i = 0; i < strangerIds.length; i += 200) {
    const { data } = await supabaseAdmin.from("messages").select("ghl_conversation_id, created_at")
      .in("ghl_conversation_id", strangerIds.slice(i, i + 200)).gte("created_at", new Date(sinceMs).toISOString()).limit(5000);
    for (const r of (data ?? []) as any[]) {
      const t = new Date(r.created_at).getTime();
      if (t > (newestStored.get(r.ghl_conversation_id) ?? 0)) newestStored.set(r.ghl_conversation_id, t);
    }
  }
  for (const { conv, token } of strangerConvs) {
    if (!strangerNeedsPull(Number(conv?.lastMessageDate), newestStored.get(conv.id))) { strangersSkipped++; continue; }
    if (Date.now() - started > budgetMs + (quick ? 0 : 20_000)) { left++; continue; }
    try {
      strangers += await pullStrangerConversation({ conv, token, sinceMs });
    } catch (e) {
      errors.push(`stranger ${conv.id}: ${e instanceof Error ? e.message : "pull failed"}`);
    }
  }

  const out = {
    ok: true, ...(quick ? { quick } : { days }), contacts, stamped, inserted, tasksRaised, held, left, conversations: convRows.length, strangers, strangersSkipped, ghlIdsFixed,
    unknownInGhl, noGhlId, notFound,
    ...(rejectedTokens.length ? { rejectedTokens } : {}),
    ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
  };
  console.log("[ghl/pull-messages]", JSON.stringify(out));
  return NextResponse.json(out);
}
