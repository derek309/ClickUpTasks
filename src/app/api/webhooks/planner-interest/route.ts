import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { resolveTrackedClientId } from "@/lib/ghlConversationTask";
import { plannerWeekLabel } from "@/lib/data";

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
  const key = process.env.CLICKUPTASKS_API_KEY || "";
  if (!key || req.headers.get("x-clickuptasks-key") !== key) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const { data: territory } = await supabaseAdmin.from("territories").select("id, assigned_to").eq("wp_city_slug", city).maybeSingle();

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
        await supabaseAdmin.from("clients").insert({ id: clientId, name: businessName, color: "#a855f7", ghl_location_id: "", status: "lead", type: "prospect", assigned_to: [] });
      }
    }
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
    const { data: openTasks } = await supabaseAdmin.from("tasks").select("id, comments").eq("client_id", clientId).eq("title", TASK_TITLE).neq("status", "done").limit(1);
    if (openTasks && openTasks.length > 0) {
      taskId = openTasks[0].id;
      const comments = Array.isArray(openTasks[0].comments) ? openTasks[0].comments : [];
      await supabaseAdmin.from("tasks").update({ comments: [...comments, newComment] }).eq("id", taskId);
    } else if (projectId) {
      taskId = "t_" + crypto.randomUUID();
      const description = event === "approved"
        ? `${businessName} approved being featured (listing already claimed) — no appointment needed, add them to the newsletter.`
        : event === "info_submitted"
        ? `${businessName} submitted business info${offerIncluded ? " + offer" : ""} from the invite landing page. Listing is hidden from the directory pending phone verification — call to confirm identity and details, then unhide it to publish.`
        : `${businessName} responded to a newsletter invite. Reach out to move them toward claiming their listing and booking an appointment.`;
      await supabaseAdmin.from("tasks").insert({
        id: taskId, project_id: projectId, client_id: clientId, title: TASK_TITLE, priority: "urgent",
        description,
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
