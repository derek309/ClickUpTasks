// SERVER-ONLY. Reads one contact's GoHighLevel conversations into the app.
//
// GoHighLevel is the record of every client conversation (Derek, 2026-09-30).
// Texts and calls live there first; email reaches it through each teammate's
// Gmail two way sync. This pull is how the app hears about all of it, and how
// it proves a message it already has made it into GoHighLevel:
//
// - A GoHighLevel message the app already stores (read from Gmail, or sent
//   from the app) gets the GoHighLevel id stamped on that row. That stamp is
//   what "confirmed in GoHighLevel" means, and it is also the dedupe key, so
//   the copy is never inserted twice. Pairing rules: lib/ghlMatch.
// - Anything else is inserted, filed on the task its conversation belongs to.
// - On the 15 minute timer (raiseTasks), a new text or missed call the team
//   has not answered raises or bumps the "Reply to X" task and rings the bell,
//   which the retired webhook workflow used to do.
//
// Used by the timer (/api/ghl/pull-messages), the client's Refresh button
// (/api/ghl/refresh-messages) and the admin backfill.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";
import { titleCase } from "@/lib/data";
import { closeAnsweredReplyTask, isClosedReplyTask, resolveOrPromoteTrackedClient, upsertConversationTask } from "@/lib/ghlConversationTask";
import { notifyInbound, sendInboundReplyEmail } from "@/lib/inboundIngest";
import { clientAnsweredOnTask } from "@/lib/clientAnswered";
import { matchGhlToLocal, isRealGhlId, MATCH_WINDOW_MS, type MatchCandidate } from "@/lib/ghlMatch";
import { raiseReplyTasks } from "@/lib/inbox";

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = "https://services.leadconnectorhq.com";

/** A GoHighLevel call failed in a way the caller should report (401 is a
 *  token GoHighLevel no longer accepts). */
export class GhlApiError extends Error {
  constructor(public status: number, detail: string) { super(`GoHighLevel API ${status}: ${detail.slice(0, 240)}`); }
}

// An email the Gmail poll has not had its turn at yet. The poll runs every 15
// minutes and stores email with the Gmail ids a reply needs for threading, so
// a young GoHighLevel email is left alone; if the Gmail row never comes, the
// next run stores GoHighLevel's copy.
const EMAIL_HOLD_MS = 20 * 60 * 1000;

// A TYPE_CALL message carries no body/subject — meta.call.duration (seconds)
// and meta.call.status are all GHL gives us (confirmed live; no transcript,
// no recording URL inline — those need separate calls we deliberately don't
// make, since only "a call happened" was asked for, not the recording).
export function formatCallBody(m: any): string {
  const status: string = m?.meta?.call?.status ?? m?.status ?? "";
  if (/missed|no-?answer|voicemail/i.test(status)) return "Missed call";
  const secs = Number(m?.meta?.call?.duration);
  if (!Number.isFinite(secs) || secs <= 0) return "Call";
  const mins = Math.floor(secs / 60), rem = secs % 60;
  return `Call · ${mins > 0 ? `${mins}m ` : ""}${rem}s`;
}

// GHL's real messageType values are "TYPE_SMS"/"TYPE_EMAIL"/"TYPE_CALL"
// (confirmed against a live conversations/{id}/messages response). Facebook,
// Instagram, website chat and Google Business messages are GoHighLevel's
// other inboxes, brought in for the Inbox (Derek, 2026-10-01).
export type GhlChannel = "sms" | "email" | "call" | "fb" | "ig" | "web" | "gbp";
const CHANNEL_BY_TYPE: Record<string, GhlChannel> = {
  TYPE_SMS: "sms", TYPE_EMAIL: "email", TYPE_CALL: "call",
  TYPE_FACEBOOK: "fb", TYPE_INSTAGRAM: "ig", TYPE_LIVE_CHAT: "web", TYPE_GMB: "gbp",
};
export const channelOf = (m: any): GhlChannel | null => CHANNEL_BY_TYPE[m?.messageType as string] ?? null;

// Sent by a GoHighLevel workflow or campaign rather than a person. Counted
// live 2026-09-30 in the Directory sub-account: of 990 recent messages, 809
// were automated email (source "workflow" or "campaign", bulk ones with no
// direction at all). They are not the team answering anyone, so they never
// close a reply task or count as a reply, and the timer does not store them.
export const isAutomated = (m: any) => m?.direction !== "inbound" && (m?.source === "workflow" || m?.source === "campaign" || (m?.direction !== "outbound"));

export type PullOpts = {
  contactId: string;
  /** The client rows are filed under (the tracked client, or the sub-account). */
  clientId: string;
  locationId: string;
  ghlContactId: string;
  /** Only messages newer than this (epoch ms). Omitted: the recent history of
   *  every conversation, as the Refresh button always read. */
  sinceMs?: number;
  /** The timer only: raise the reply task for an unanswered text or missed call. */
  raiseTasks: boolean;
  token?: string;
  now?: number;
};
export type PullResult = { inserted: number; stamped: number; bound: number; tasksRaised: number; held: number };

type GhlMsg = { m: any; conv: string; channel: GhlChannel; at: number };

export async function pullContactConversations(o: PullOpts): Promise<PullResult> {
  const now = o.now ?? Date.now();
  const result: PullResult = { inserted: 0, stamped: 0, bound: 0, tasksRaised: 0, held: 0 };
  const token = o.token ?? await tokenForLocation(o.locationId);
  if (!token) throw new GhlApiError(501, "No GoHighLevel token configured for this sub-account yet.");
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" };

  const searchRes = await fetch(`${API}/conversations/search?locationId=${encodeURIComponent(o.locationId)}&contactId=${encodeURIComponent(o.ghlContactId)}&limit=10`, { headers });
  if (!searchRes.ok) throw new GhlApiError(searchRes.status, await searchRes.text().catch(() => ""));
  const conversations: any[] = (await searchRes.json())?.conversations ?? [];
  if (!conversations.length) return result;

  // ── Read: every conversation's messages in the window ──────────────────
  const fetched: GhlMsg[] = [];
  const seenByConv = new Map<string, string[]>();
  for (const conv of conversations) {
    let lastMessageId: string | undefined;
    for (let page = 0; page < 5; page++) { // ~100 messages per conversation, plenty for a refresh
      const q = new URLSearchParams({ limit: "20" });
      if (lastMessageId) q.set("lastMessageId", lastMessageId);
      const msgRes = await fetch(`${API}/conversations/${encodeURIComponent(conv.id)}/messages?${q}`, { headers });
      if (!msgRes.ok) break;
      const msgJson = await msgRes.json();
      // GHL nests the page: { messages: { messages: [...], nextPage, lastMessageId } }.
      // Tolerate a flat { messages: [...], nextPage, lastMessageId } too.
      const container = msgJson?.messages;
      const messages: any[] = Array.isArray(container) ? container : (Array.isArray(container?.messages) ? container.messages : []);
      const nextPage = Array.isArray(container) ? msgJson?.nextPage : container?.nextPage;
      const pageLastId = Array.isArray(container) ? msgJson?.lastMessageId : container?.lastMessageId;
      seenByConv.set(conv.id, [...(seenByConv.get(conv.id) ?? []), ...messages.map((m) => m?.id).filter(Boolean)]);
      let older = false;
      for (const m of messages) {
        const channel = channelOf(m);
        const at = m?.dateAdded ? new Date(m.dateAdded).getTime() : NaN;
        if (!m?.id || !channel || !Number.isFinite(at)) continue;
        if (o.sinceMs !== undefined && at < o.sinceMs) { older = true; continue; }
        // The timer keeps to what people said; the Refresh button still
        // shows a client's whole history, automated mail included.
        if (o.raiseTasks && isAutomated(m)) continue;
        fetched.push({ m, conv: conv.id, channel, at });
      }
      // Pages come newest first, so a page reaching past the window ends it.
      if (older || !nextPage || !pageLastId) break;
      lastMessageId = pageLastId;
    }
  }

  // ── What the app already has for this contact ──────────────────────────
  const { data: existingRows } = await supabaseAdmin.from("messages").select("ghl_message_id").eq("contact_id", o.contactId).not("ghl_message_id", "is", null);
  const known = new Set((existingRows ?? []).map((r: any) => r.ghl_message_id as string));
  const fresh = fetched.filter((f) => !known.has(f.m.id));

  // Rows GoHighLevel has not confirmed yet: the ones a fetched message may be
  // a copy of. Read once, over the window the fetched messages span.
  let candidates: MatchCandidate[] = [];
  if (fresh.length) {
    const from = Math.min(...fresh.map((f) => f.at)) - MATCH_WINDOW_MS;
    const { data: unconfirmed } = await supabaseAdmin
      .from("messages").select("id, channel, direction, body, subject, created_at, ghl_message_id")
      .eq("contact_id", o.contactId).in("channel", ["email", "sms", "call"])
      .gte("created_at", new Date(from).toISOString())
      .order("created_at", { ascending: false }).limit(1000);
    candidates = (unconfirmed ?? [])
      .filter((r: any) => !isRealGhlId(r.ghl_message_id))
      .map((r: any) => ({ id: r.id, channel: r.channel, direction: r.direction, body: r.body, subject: r.subject, at: new Date(r.created_at).getTime() }));
  }

  // Conversations already being worked on a real task. Read up front, one
  // query for the contact, rather than per message.
  const convTaskIds = new Map<string, string>();
  {
    const { data: bound } = await supabaseAdmin
      .from("messages").select("ghl_conversation_id, task_id, created_at")
      .eq("contact_id", o.contactId).not("ghl_conversation_id", "is", null).not("task_id", "is", null)
      .order("created_at", { ascending: false }).limit(200);
    for (const r of bound ?? []) {
      const cid = r.ghl_conversation_id as string;
      if (!convTaskIds.has(cid)) convTaskIds.set(cid, r.task_id as string);
    }
  }
  const { data: openTask } = await supabaseAdmin.from("tasks").select("id").eq("contact_id", o.contactId).eq("priority", "conversation").neq("status", "done").limit(1).maybeSingle();
  const openTaskId: string | null = (openTask as any)?.id ?? null;

  // GoHighLevel's messages list omits `body` on a large share of emails
  // (237 of 707 as of 2026-08-12). The content lives behind a separate
  // per-email endpoint keyed on meta.email.messageIds[0] (the conversation
  // message id is rejected there). Filled before pairing, since the body is
  // half of what pairs an email.
  await Promise.all(fresh.map(async (f) => {
    if (f.channel !== "email" || f.m.body) return;
    const emailId = f.m?.meta?.email?.messageIds?.[0];
    if (typeof emailId !== "string" || !emailId) return;
    try {
      const er = await fetch(`${API}/conversations/messages/email/${encodeURIComponent(emailId)}`, { headers });
      if (!er.ok) return; // left blank; the feed labels that honestly
      const em = (await er.json())?.emailMessage;
      if (typeof em?.body === "string" && em.body) f.m.body = em.body;
      if (!f.m.subject && typeof em?.subject === "string") f.m.subject = em.subject;
    } catch { /* network hiccup — a blank body is still a valid row */ }
  }));

  // ── Pair or insert ─────────────────────────────────────────────────────
  const claimed = new Set<string>();
  const toInsert: { row: Record<string, any>; f: GhlMsg }[] = [];
  for (const f of fresh) {
    const direction = f.m.direction === "inbound" ? "inbound" : "outbound";
    const subject = f.m.subject ?? f.m.meta?.email?.subject ?? null;
    const body = f.channel === "call" ? formatCallBody(f.m) : (f.m.body ?? "");
    const localId = matchGhlToLocal({ channel: f.channel, direction, body, subject, at: f.at }, candidates, claimed);
    if (localId) {
      claimed.add(localId);
      // The guard keeps a row that some other path confirmed meanwhile; a
      // unique index hit means another row already holds this id. Either way
      // nothing is inserted.
      const { data: stampedRows } = await supabaseAdmin
        .from("messages").update({ ghl_message_id: f.m.id, ghl_conversation_id: f.conv })
        .eq("id", localId).or("ghl_message_id.is.null,ghl_message_id.like.synthetic:*").select("id");
      if (stampedRows?.length) result.stamped++;
      known.add(f.m.id);
      continue;
    }
    if (f.channel === "email" && now - f.at < EMAIL_HOLD_MS) { result.held++; continue; }
    toInsert.push({
      f,
      row: {
        id: "msg_ghl_" + f.m.id,
        contact_id: o.contactId,
        client_id: o.clientId,
        channel: f.channel,
        direction,
        subject,
        // A call carries no body/subject from GHL, so the "content" is a
        // short synthesized summary instead of a real message body.
        body,
        ghl_message_id: f.m.id,
        // The thread key: lets the next message on this conversation find
        // the task it landed on last time.
        ghl_conversation_id: f.conv,
        created_by: null,
        created_at: new Date(f.at).toISOString(),
        // A task already bound to this conversation wins over the open
        // Conversation task (unless it is a reply task that closed itself).
        // With reply tasks off, only a conversation already linked to a task.
        task_id: convTaskIds.get(f.conv) ?? (raiseReplyTasks() ? openTaskId : null),
      },
    });
  }

  // ── Which new messages still need someone ──────────────────────────────
  // A text, or a missed call, that nobody has answered since: nothing
  // outbound, in GoHighLevel or in the app, is newer. Reading two days of
  // history must not raise a task for an exchange that already finished.
  let raise: typeof toInsert = [];
  if (o.raiseTasks && raiseReplyTasks()) {
    const { data: lastOut } = await supabaseAdmin
      .from("messages").select("created_at").eq("contact_id", o.contactId).eq("direction", "outbound")
      .order("created_at", { ascending: false }).limit(1);
    const lastOutAt = Math.max(
      lastOut?.[0]?.created_at ? new Date(lastOut[0].created_at as string).getTime() : 0,
      ...fetched.filter((f) => f.m.direction !== "inbound" && !isAutomated(f.m)).map((f) => f.at),
    );
    raise = toInsert.filter(({ row, f }) => row.direction === "inbound"
      && (row.channel === "sms" || (row.channel === "call" && row.body === "Missed call"))
      && f.at > lastOutAt);
  }

  // The first real message from someone never promoted gets its own client,
  // as the webhook did; their rows are filed there rather than under the
  // sub-account.
  let contact: { id: string; name: string; client_id: string } | null = null;
  if (raise.length) {
    const { data: c } = await supabaseAdmin.from("contacts").select("id, name, client_id").eq("id", o.contactId).maybeSingle();
    if (c) {
      contact = { ...(c as any), client_id: await resolveOrPromoteTrackedClient(c as any) };
      for (const { row } of toInsert) row.client_id = contact!.client_id;
    }
  }

  // A reply task that closed itself does not collect the next message.
  const closed = new Map<string, boolean>();
  for (const { row } of toInsert) {
    const t = row.task_id as string | null;
    if (!t || t === openTaskId) continue;
    if (!closed.has(t)) closed.set(t, await isClosedReplyTask(t));
    if (closed.get(t)) row.task_id = openTaskId;
  }

  if (toInsert.length) {
    const rows = toInsert.map((t) => t.row);
    const { error } = await supabaseAdmin.from("messages").insert(rows);
    if (!error) {
      result.inserted += rows.length;
      rows.forEach((r) => known.add(r.ghl_message_id));
      // A text or email answered from inside GoHighLevel only reaches the
      // app through this pull, so this is where it closes the reply task.
      const answeredAt = openTaskId ? toInsert.filter(({ row: r, f }) => r.direction === "outbound" && r.channel !== "call" && r.task_id === openTaskId && !isAutomated(f.m)).map(({ row: r }) => r.created_at as string).sort().at(-1) : undefined;
      if (answeredAt) await closeAnsweredReplyTask(openTaskId, answeredAt, null, "GoHighLevel");
    } else {
      console.error("[ghlPull] insert failed", o.contactId, error.message);
      raise = [];
    }
  }

  if (raise.length && contact) {
    // One task and one bell per contact per run, however many texts came in.
    const latest = raise.reduce((a, b) => (b.f.at > a.f.at ? b : a));
    const bound = latest.row.task_id && latest.row.task_id !== openTaskId ? latest.row.task_id as string : null;
    const taskId = bound ?? await upsertConversationTask(contact, o.ghlContactId);
    if (taskId) {
      const ids = raise.filter((r) => !r.row.task_id || r.row.task_id === openTaskId).map((r) => r.row.id as string);
      if (ids.length) await supabaseAdmin.from("messages").update({ task_id: taskId }).in("id", ids);
      result.tasksRaised++;
    }
    await clientAnsweredOnTask(taskId, "reply");
    const name = titleCase(contact.name);
    const text = latest.row.channel === "sms"
      ? `${name} sent a text: ${String(latest.row.body).replace(/\s+/g, " ").trim().slice(0, 80)}`
      : `📞 Missed call from ${name}`;
    const recipients = await notifyInbound(contact, taskId, text);
    if (latest.row.channel === "sms") {
      await sendInboundReplyEmail({ clientId: contact.client_id, contactName: contact.name, channel: "sms", body: latest.row.body, taskId, recipientIds: recipients });
    }
  }

  // Heal rows stored before ghl_conversation_id existed: the conversation a
  // page came from is the only place that id can come from.
  for (const [convId, ids] of seenByConv) {
    if (!ids.length) continue;
    const { data: healed } = await supabaseAdmin
      .from("messages").update({ ghl_conversation_id: convId })
      .in("ghl_message_id", ids).is("ghl_conversation_id", null)
      .select("id");
    result.bound += healed?.length ?? 0;
  }
  return result;
}

// ── People who are not contacts yet ──────────────────────────────────────
// A GoHighLevel conversation whose contact the app does not know (a Facebook
// lead, a website chat, a text from a new number) still belongs in the Inbox
// (Derek, 2026-10-01). Its messages are stored with no contact and no client,
// keyed on the GoHighLevel conversation, and say who the person is on the row.
// Email is left to the Gmail poll, which reads every teammate's mail directly.
// Nothing is raised or rung: the Inbox is the alert.
export async function pullStrangerConversation(o: {
  conv: any; token: string; sinceMs: number;
}): Promise<number> {
  const headers = { Authorization: `Bearer ${o.token}`, Version: "2021-04-15", Accept: "application/json" };
  const conv = o.conv;
  const rows: Record<string, any>[] = [];
  let lastMessageId: string | undefined;
  for (let page = 0; page < 3; page++) {
    const q = new URLSearchParams({ limit: "20" });
    if (lastMessageId) q.set("lastMessageId", lastMessageId);
    const res = await fetch(`${API}/conversations/${encodeURIComponent(conv.id)}/messages?${q}`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) break;
    const json = await res.json();
    const container = json?.messages;
    const messages: any[] = Array.isArray(container) ? container : (Array.isArray(container?.messages) ? container.messages : []);
    let older = false;
    for (const m of messages) {
      const channel = channelOf(m);
      const at = m?.dateAdded ? new Date(m.dateAdded).getTime() : NaN;
      if (!m?.id || !channel || channel === "email" || !Number.isFinite(at)) continue;
      if (at < o.sinceMs) { older = true; continue; }
      if (isAutomated(m)) continue;
      rows.push({
        id: "msg_ghl_" + m.id, contact_id: null, client_id: null, task_id: null,
        channel, direction: m.direction === "inbound" ? "inbound" : "outbound",
        subject: null, body: channel === "call" ? formatCallBody(m) : (m.body ?? ""),
        ghl_message_id: m.id, ghl_conversation_id: conv.id, created_by: null,
        created_at: new Date(at).toISOString(),
        peer_name: conv.fullName || conv.contactName || null,
        peer_address: conv.phone || conv.email || null,
        read: m.direction !== "inbound",
      });
    }
    const nextPage = Array.isArray(container) ? json?.nextPage : container?.nextPage;
    const pageLastId = Array.isArray(container) ? json?.lastMessageId : container?.lastMessageId;
    if (older || !nextPage || !pageLastId) break;
    lastMessageId = pageLastId;
  }
  if (!rows.length) return 0;
  // A conversation someone linked to a task keeps collecting there.
  const { data: linked } = await supabaseAdmin.from("messages").select("task_id")
    .eq("ghl_conversation_id", conv.id).not("task_id", "is", null).order("created_at", { ascending: false }).limit(1);
  const taskId = (linked?.[0]?.task_id as string | undefined) ?? null;
  const { data: have } = await supabaseAdmin.from("messages").select("ghl_message_id").in("ghl_message_id", rows.map((r) => r.ghl_message_id));
  const known = new Set((have ?? []).map((r: any) => r.ghl_message_id as string));
  const fresh = rows.filter((r) => !known.has(r.ghl_message_id)).map((r) => ({ ...r, task_id: taskId }));
  if (!fresh.length) return 0;
  const { error } = await supabaseAdmin.from("messages").insert(fresh);
  if (error) { console.error("[ghlPull] stranger insert failed", conv.id, error.message); return 0; }
  return fresh.length;
}

/** GoHighLevel user id → our roster id, matched by email, for one sub-account.
 *  Needs users.readonly on the Private Integration; without it every
 *  conversation reads as unassigned, so it shows for the whole team. */
export async function ghlUsersToMembers(locationId: string, token: string, memberByEmail: Map<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const res = await fetch(`${API}/users/?locationId=${encodeURIComponent(locationId)}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return out;
    for (const u of ((await res.json())?.users ?? []) as any[]) {
      const member = memberByEmail.get(String(u?.email ?? "").toLowerCase());
      if (u?.id && member) out.set(u.id as string, member);
    }
  } catch { /* unassigned for everyone this run */ }
  return out;
}

/** The row kept for each conversation: who it is assigned to on our roster
 *  decides whose Inbox shows it (assigned to you, or to nobody). */
export function ghlConversationRow(c: any, locationId: string, members: Map<string, string>) {
  const assigned = typeof c?.assignedTo === "string" && c.assignedTo ? c.assignedTo as string : null;
  const last = Number(c?.lastMessageDate);
  return {
    id: c.id as string, location_id: locationId, ghl_contact_id: c?.contactId ?? null,
    // Assigned to someone not on our roster (an outside GoHighLevel user):
    // kept out of everyone's Inbox. Only when the user list loaded, though;
    // without it nothing can be told apart, so it shows for the whole team.
    assigned_ghl_user_id: assigned,
    assigned_member_id: assigned ? members.get(assigned) ?? (members.size ? `ghl:${assigned}` : null) : null,
    channel_type: c?.type ?? null,
    contact_name: c?.fullName || c?.contactName || null, phone: c?.phone || null, email: c?.email || null,
    last_message_at: Number.isFinite(last) ? new Date(last).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}
