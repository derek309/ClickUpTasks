import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { resolveTrackedClientId, SAFE_CONTACT_ID } from "@/lib/ghlConversationTask";
import { completePlaybookStepServer } from "@/lib/playbookReconcileServer";
import { plannerWeekLabel } from "@/lib/data";
import { verifyClickUpTasksKey } from "@/lib/verifyBridgeKey";
// slugify only, not citySlugForTerritory: this direction goes the other way —
// it reverse-matches an inbound city slug against every territory, so it needs
// the raw function, not a lookup by territory id.
import { slugify } from "@/lib/wpCitySlug";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Inbound webhook: WordPress -> ClickUpTasks, fired the instant a business
// responds to a Content Planner "invite to be featured" (see
// sales-outreach.php's cul_sales_notify_clickuptasks_interest, called from
// cul_sales_rest_join / cul_sales_rest_join_intake). This is the other half
// of the loop /api/planner/invite/send starts — the newsletter is bait, this
// is the bite: claim the listing, book an appointment, pitch the platform is
// worked from here, not WordPress's own outreach board, which is otherwise
// invisible to the team. See /Users/derekfox/.claude/plans/
// twinkly-puzzling-prism.md for the full design.
//
// Auth: the same shared secret as the outbound direction (X-ClickUpTasks-Key
// checked against CLICKUPTASKS_API_KEY) — just read as an inbound header
// here instead of sent as an outbound one.

const TASK_TITLE = "Newsletter invite response";
// The MCP server's own synthetic roster identity (see data.ts's PROTECTED_USER_IDS)
// — reused here as the author of an automated, no-human-actor comment, the
// same "system posted this" convention the app already has, rather than a
// bare null author.
const SYSTEM_AUTHOR_ID = "u_claude";

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!verifyClickUpTasksKey(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const event: string = body?.event ?? "";
  const city: string = String(body?.city ?? "").trim();
  const week: string = String(body?.week ?? "").trim();
  const businessName: string = String(body?.business_name ?? "").trim() || "Unknown business";
  const email: string = String(body?.email ?? "").trim();
  const phone: string = String(body?.phone ?? "").trim();
  const ghlContactId: string = String(body?.ghl_contact_id ?? "").trim();
  const KNOWN_EVENTS = ["interested", "intake", "approved", "info_submitted"];
  if (!city || !week || !KNOWN_EVENTS.includes(event)) {
    return NextResponse.json({ error: "Missing city/week or unknown event" }, { status: 400 });
  }
  // Third entry point that feeds a caller-supplied GHL contact id into a
  // PostgREST .or() filter string (via resolveTrackedClientId below, keyed on
  // `ct_ghl_${ghlContactId}`) and into ids it creates — validated at the edge,
  // same shape as api/external/playbook/[ghlContactId].
  if (ghlContactId && !SAFE_CONTACT_ID.test(ghlContactId)) {
    return NextResponse.json({ error: "Invalid ghl_contact_id" }, { status: 400 });
  }

  // wp_city_slug is an optional per-territory override, null on every
  // territory today — the effective slug WordPress actually sent is
  // wp_city_slug || slugify(city), same fallback the outbound routes
  // (invite/send, push) already use. A raw .eq("wp_city_slug", city") here
  // would never match anything, so fetch and reverse-match in JS instead.
  const { data: territories } = await supabaseAdmin.from("territories").select("id, city, wp_city_slug, assigned_to");
  const territory = (territories ?? []).find((t: any) => (t.wp_city_slug || slugify(String(t.city ?? ""))) === city) ?? null;

  // Flip the matching week.invited entry's status to "accepted" so the
  // Planner can show real response state instead of just "sent" — but only
  // once they've actually engaged, not the instant the landing page loads.
  // "interested" fires automatically on page load (the join page auto-POSTs
  // it before showing the intake questions — sales-outreach.php's Step 1
  // skip), so on its own it's not a real signal of interest, just that the
  // link was opened. "intake" (answered the 3 questions), "approved"
  // (already-claimed, approved outright), and "info_submitted" (completed
  // the claim funnel) are the real engagement signals (Derek, Aug 3) — only
  // those flip status. "interested" still records respondedAt/responseEvent
  // for the audit trail, just leaves status as "invited" until a stronger
  // signal arrives. WordPress has no "declined" event to send, so there's
  // nothing to write for a no. Independent of the client/task work below; a
  // listing invited before this shipped, or an invite link with no matching
  // week row, just means nothing to update — not an error.
  const gdPlaceId = Number(body?.listing_id);
  if (territory?.id && Number.isFinite(gdPlaceId)) {
    const { data: weekRow } = await supabaseAdmin.from("planner_weeks").select("id, picks").eq("territory_id", territory.id).eq("week", week).maybeSingle();
    if (weekRow) {
      const picks = (weekRow.picks && typeof weekRow.picks === "object") ? { ...(weekRow.picks as any) } : {};
      const invited: any[] = Array.isArray(picks.__invited) ? picks.__invited : [];
      // A business can be (re-)invited more than once (sends aren't
      // deduped) — the most recent send for this listing is the one this
      // response belongs to.
      let latestIdx = -1;
      for (let i = 0; i < invited.length; i++) if (invited[i]?.gdPlaceId === gdPlaceId) latestIdx = i;
      if (latestIdx !== -1) {
        const patch: any = { respondedAt: new Date().toISOString(), responseEvent: event };
        if (event !== "interested") patch.status = "accepted";
        invited[latestIdx] = { ...invited[latestIdx], ...patch };
        await supabaseAdmin.from("planner_weeks").update({ picks: { ...picks, __invited: invited } }).eq("id", weekRow.id);
      }
    }
  }

  // Resolve (or create) the tracked client this response belongs to. Only
  // possible when WordPress sent a ghl_contact_id — set on the listing when
  // the invite was originally sent (cul_sales_ghl_send_invite), so this is
  // the common case; an older/never-GHL-invited listing has nothing to key
  // off, and the task below still gets created untracked so the rep isn't
  // left with nothing.
  let clientId: string | null = null;
  if (ghlContactId) {
    const contactId = `ct_ghl_${ghlContactId}`;
    const { data: existingContact } = await supabaseAdmin.from("contacts").select("id, client_id").eq("ghl_contact_id", ghlContactId).maybeSingle();
    const fallbackClientId = existingContact?.client_id ?? `cl_${contactId}`;
    if (!existingContact) {
      await supabaseAdmin.from("contacts").upsert({ id: contactId, client_id: fallbackClientId, name: businessName, email: email || null, phone: phone || null, ghl_contact_id: ghlContactId });
    }
    clientId = await resolveTrackedClientId(contactId, fallbackClientId);
    if (clientId === fallbackClientId) {
      // Nothing tracked yet — a business that just said "feature me" is a
      // real, active prospect now. Promote them, same status/type
      // convention syncTerritoryClients uses for territory-sourced
      // businesses (Cockpit.tsx).
      const { data: existingClient } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
      if (!existingClient) {
        await supabaseAdmin.from("clients").insert({ id: clientId, name: businessName, color: "#a855f7", ghl_location_id: "", status: "claimed", type: "prospect", assigned_to: [] });
      }
    }
  }

  // Sales pipeline automation: the same real-engagement gate as the
  // status:"accepted" flip above (event !== "interested" — a page-load auto
  // fire isn't a real response, see the comment on that block). A genuine
  // reply is exactly "Engaged / interested," SALES_STAGE_STEPS' second stage.
  if (clientId && event !== "interested") {
    await completePlaybookStepServer(clientId, "sales_engaged", `Automatically completed, replied to the newsletter invite ("${event}").`);
  }

  // Reuse the client's existing project, else create a "Tasks" fallback —
  // same idiom ghlConversationTask.ts's upsertConversationTask uses.
  let projectId: string | null = null;
  if (clientId) {
    const { data: proj } = await supabaseAdmin.from("projects").select("id").eq("client_id", clientId).limit(1).maybeSingle();
    projectId = proj?.id ?? null;
    if (!projectId) {
      projectId = "p_" + crypto.randomUUID();
      await supabaseAdmin.from("projects").insert({ id: projectId, client_id: clientId, name: "Tasks", description: "" });
    }
  }

  const offerIncluded = Boolean(body?.offer_included);
  const weekLabel = plannerWeekLabel(week);
  const eventLine = event === "interested"
    ? `Clicked "I'm interested" on the ${weekLabel} newsletter invite.`
    : event === "approved"
    ? `Approved being featured in the ${weekLabel} newsletter (listing already claimed) — no appointment needed, ready to add to the newsletter.`
    : event === "info_submitted"
    ? `Submitted business info${offerIncluded ? " + offer" : ""} from the invite landing page. The listing is now HIDDEN from the directory pending phone verification — confirm identity and details on the call, then uncheck "Hide From Directory" in wp-admin to publish.\n`
      + Object.entries(body?.answers ?? {}).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "Submitted intake answers on the newsletter invite:\n" + Object.entries(body?.answers ?? {}).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const newComment = { id: "cm_" + crypto.randomUUID(), authorId: SYSTEM_AUTHOR_ID, body: eventLine, at: new Date().toISOString(), kind: "event" };

  // Find an already-open response task for this client — the interested
  // click and the intake submit usually happen back to back in the same
  // visit — and append to it instead of creating a duplicate.
  let taskId: string | null = null;
  if (clientId) {
    const { data: openTasks } = await supabaseAdmin.from("tasks").select("id").eq("client_id", clientId).eq("title", TASK_TITLE).neq("status", "done").limit(1);
    if (openTasks && openTasks.length > 0) {
      taskId = openTasks[0].id;
      // Atomic JSONB append (append_comment, supabase/realtime.sql) rather
      // than read-modify-write of the whole comments array — "interested" and
      // "intake" fire back to back in the same visit, and a rep commenting on
      // the task at that moment would otherwise have their comment (or the
      // webhook's) silently dropped by whichever write landed second.
      await supabaseAdmin.rpc("append_comment", { task_id: taskId, comment: newComment });
    } else if (projectId) {
      taskId = "t_" + crypto.randomUUID();
      const description = event === "approved"
        ? `${businessName} approved being featured (listing already claimed) — no appointment needed, add them to the newsletter.`
        : event === "info_submitted"
        ? `${businessName} submitted business info${offerIncluded ? " + offer" : ""} from the invite landing page. Listing is hidden from the directory pending phone verification — call to confirm identity and details, then unhide it to publish.`
        : `${businessName} responded to a newsletter invite. Reach out to move them toward claiming their listing and booking an appointment.`;
      await supabaseAdmin.from("tasks").insert({
        id: taskId, project_id: projectId, client_id: clientId, title: TASK_TITLE, priority: "conversation",
        description, created_by: "client",
        comments: [newComment],
      });
    }
  }

  // Notify the territory's assigned reps, falling back to all admins — same
  // fallback /api/waiting/[token]/respond/route.ts already uses.
  let recipients: string[] = Array.isArray(territory?.assigned_to) ? (territory!.assigned_to as string[]) : [];
  if (recipients.length === 0) {
    const { data: admins } = await supabaseAdmin.from("profiles").select("member_id").eq("role", "admin");
    recipients = (admins ?? []).map((a: any) => a.member_id).filter((m: any): m is string => typeof m === "string" && !!m);
  }
  if (recipients.length > 0) {
    const nowIso = new Date().toISOString();
    const notifText = event === "interested"
      ? `${businessName} responded "interested" to this week's newsletter invite`
      : event === "approved"
      ? `${businessName} approved being featured — already claimed, no appointment needed`
      : event === "info_submitted"
      ? `${businessName} submitted info — listing hidden, needs a verification call`
      : `${businessName} submitted intake answers for this week's newsletter invite`;
    await supabaseAdmin.from("notifications").insert(recipients.map((rid) => ({
      id: "n_" + crypto.randomUUID(), recipient_id: rid, text: notifText, task_id: taskId,
      actor_id: null, client_id: clientId, project_id: projectId, at: nowIso, read: false, kind: "activity",
    })));
  }

  return NextResponse.json({ ok: true });
}
