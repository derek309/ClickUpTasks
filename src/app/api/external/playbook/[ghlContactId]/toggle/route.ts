import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { resolveTrackedClientId, SAFE_CONTACT_ID } from "@/lib/ghlConversationTask";
import { reconcilePlaybookTasksServer } from "@/lib/playbookReconcileServer";
import { verifyClickUpTasksKey } from "@/lib/verifyBridgeKey";
import { PLAYBOOK_ALL_STEPS, PLAYBOOK_STEP_BY_KEY, PLAYBOOK_STEPS, PLAYBOOK_PHASES, playbookProjectId, advanceDue, todayIso } from "@/lib/data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Inbound WordPress -> ClickUpTasks: the owner checked/unchecked a Playbook
// step from their own /my-business/{slug}/ dashboard. Server-side twin of
// the relevant parts of Cockpit.tsx's patchTask, since there is no existing
// server-side task-update route to call into (all task mutation there runs
// browser -> Supabase directly). Replicates: status flip, an activity-feed
// comment, and the recurrence clone-on-done (only ever fires for
// monthly_proof_report, the one recurring step). Deliberately skips GHL sync
// (playbook-step tasks are always created with ghlTaskId: null and never
// otherwise linked) and adds an admin notification worded to make clear the
// *owner* completed it, so ambassadors don't mistake it for a teammate's own
// action.
//
// Unlike the GET route, this DOES auto-promote an unresolved contact into a
// tracked client — a real self-reported completion is exactly the kind of
// signal that justifies it, same reasoning resolveOrPromoteTrackedClient's
// own doc comment already gives for inbound messages/calls/appointments.
const SYSTEM_AUTHOR_ID = "u_derek";

export async function POST(req: NextRequest, { params }: { params: Promise<{ ghlContactId: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!verifyClickUpTasksKey(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ghlContactId } = await params;
  if (!ghlContactId) return NextResponse.json({ error: "Missing ghlContactId" }, { status: 400 });
  // Same edge validation as the GET twin: this value reaches a PostgREST
  // .or() filter string and is interpolated into a client id it then CREATES.
  if (!SAFE_CONTACT_ID.test(ghlContactId)) return NextResponse.json({ error: "Invalid ghlContactId" }, { status: 400 });

  const body = await req.json().catch(() => ({} as any));
  const stepKey: string = String(body?.stepKey ?? "").trim();
  const done: boolean = Boolean(body?.done);
  const businessName: string = String(body?.businessName ?? "").trim() || "Unknown business";
  const step = PLAYBOOK_STEP_BY_KEY.get(stepKey);
  if (!stepKey || !step) return NextResponse.json({ error: "Unknown stepKey" }, { status: 400 });
  // Only steps the GET twin actually publishes to the owner's dashboard are
  // togglable from it. PLAYBOOK_STEP_BY_KEY is a superset now that it also
  // resolves the internal sales pipeline stages (SALES_STAGE_STEPS) — an
  // owner has no surface that shows those and no business flipping "Won,
  // active $197" on themselves, so the write side is pinned to the same
  // catalog the read side enumerates.
  if (!PLAYBOOK_ALL_STEPS.some((s) => s.key === stepKey)) return NextResponse.json({ error: "Unknown stepKey" }, { status: 400 });

  const fallback = "cl_" + ghlContactId;
  let clientId = await resolveTrackedClientId(ghlContactId, fallback);
  if (clientId === fallback) {
    const { data: existing } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!existing) {
      const { error } = await supabaseAdmin.from("clients").insert({
        id: clientId, name: businessName, color: "#a855f7", ghl_location_id: "", status: "claimed", type: "prospect", assigned_to: [],
      });
      // A concurrent toggle for the same never-before-seen contact can lose
      // this insert race — fall back to whatever's resolvable now rather
      // than strand the request on a client id that doesn't exist.
      if (error) clientId = await resolveTrackedClientId(ghlContactId, fallback);
    }
  }

  await reconcilePlaybookTasksServer(clientId);

  const { data: task } = await supabaseAdmin.from("tasks").select("*").eq("client_id", clientId).eq("playbook_step_key", stepKey).maybeSingle();
  if (!task) return NextResponse.json({ error: "Playbook step not found" }, { status: 404 });

  const newStatus = done ? "done" : "todo";
  if (task.status === newStatus) return NextResponse.json({ success: true, done });

  const eventBody = done ? "owner marked this done from their business dashboard" : "owner reopened this from their business dashboard";
  const comment = { id: "cm_" + crypto.randomUUID(), authorId: SYSTEM_AUTHOR_ID, body: eventBody, at: new Date().toISOString(), kind: "event" };
  await supabaseAdmin.rpc("append_comment", { task_id: task.id, comment });
  await supabaseAdmin.from("tasks").update({ status: newStatus, updated_by: null }).eq("id", task.id);

  // Only the single monthly_proof_report step is ever recurring — cheap to
  // check unconditionally rather than special-case the key.
  if (newStatus === "done" && task.recurrence && task.recurrence !== "none") {
    const nextDue = advanceDue(task.due, task.recurrence, task.recurrence_interval, task.recurrence_unit, task.recurrence_days_of_month);
    await supabaseAdmin.from("tasks").insert({
      id: "t_" + crypto.randomUUID(), project_id: task.project_id, client_id: task.client_id, title: task.title,
      status: "todo", priority: task.priority, contact_id: task.contact_id, due: nextDue,
      recurrence: task.recurrence, recurrence_interval: task.recurrence_interval ?? null, recurrence_unit: task.recurrence_unit ?? null,
      recurrence_days_of_month: task.recurrence_days_of_month ?? null, playbook_step_key: stepKey,
      created_by: task.created_by ?? null,
    });
  }

  // Bump playbook_last_progress_at regardless of milestone status — the
  // daily stall-check cron (playbookCheckinsServer.ts) uses this to tell
  // "quiet because it's done" apart from "quiet because it's stuck."
  await supabaseAdmin.from("clients").update({ playbook_last_progress_at: new Date().toISOString() }).eq("id", clientId);

  // Progress-trigger check-in: only for owner-driven completions (this
  // route — a teammate completing a step in-app doesn't need a task telling
  // them what they just did), and only the main phased path (PLAYBOOK_STEPS)
  // — the bonus tracks (A2P/email-domain/ongoing) have no phases to complete.
  if (done && PLAYBOOK_STEPS.some((s) => s.key === stepKey)) {
    const { data: siblingTasks } = await supabaseAdmin.from("tasks").select("playbook_step_key, status").eq("client_id", clientId).not("playbook_step_key", "is", null);
    const doneKeys = new Set((siblingTasks ?? []).filter((t: any) => t.status === "done").map((t: any) => t.playbook_step_key as string));
    const doneMainCount = PLAYBOOK_STEPS.filter((s) => doneKeys.has(s.key)).length;
    const stepsInPhase = PLAYBOOK_STEPS.filter((s) => s.phase === step.phase);
    const phaseJustCompleted = stepsInPhase.every((s) => doneKeys.has(s.key));
    const allComplete = doneMainCount === PLAYBOOK_STEPS.length;
    const isFirstEver = doneMainCount === 1;

    let checkinTitle: string | null = null;
    let checkinBody = "";
    if (allComplete) {
      checkinTitle = "Check in — Owner Growth Plan complete!";
      checkinBody = `${businessName} just finished every step of their Owner Growth Plan. Great moment to celebrate and talk about what's next.`;
    } else if (phaseJustCompleted) {
      const phaseLabel = PLAYBOOK_PHASES.find((p) => p.key === step.phase)?.label ?? step.phase;
      checkinTitle = "Check in — nice playbook progress";
      checkinBody = `${businessName} just finished the "${phaseLabel}" phase of their Owner Growth Plan. Good moment to check in and push the next step.`;
    } else if (isFirstEver) {
      checkinTitle = "Check in — playbook engagement just started";
      checkinBody = `${businessName} completed their first Owner Growth Plan step. Good moment to check in and keep the momentum going.`;
    }

    if (checkinTitle) {
      const { data: clientRow } = await supabaseAdmin.from("clients").select("assigned_to").eq("id", clientId).maybeSingle();
      const assignee = ((clientRow?.assigned_to as string[] | null) ?? [])[0] ?? null;
      await supabaseAdmin.from("tasks").insert({
        id: "t_" + crypto.randomUUID(), project_id: playbookProjectId(clientId), client_id: clientId, title: checkinTitle, description: checkinBody,
        status: "todo", priority: "normal", assignee_id: assignee, due: todayIso(),
        checkin_kind: "playbook_progress", created_by: SYSTEM_AUTHOR_ID,
      });
    }
  }

  if (done) {
    const { data: admins } = await supabaseAdmin.from("profiles").select("member_id").eq("role", "admin");
    const recipients = (admins ?? []).map((a: any) => a.member_id).filter((m: any): m is string => typeof m === "string" && !!m);
    if (recipients.length > 0) {
      const nowIso = new Date().toISOString();
      await supabaseAdmin.from("notifications").insert(recipients.map((rid) => ({
        id: "n_" + crypto.randomUUID(), recipient_id: rid, text: `${businessName} marked "${step.label}" done in their Playbook`,
        task_id: task.id, actor_id: null, client_id: clientId, project_id: task.project_id, at: nowIso, read: false, kind: "activity",
      })));
    }
  }

  return NextResponse.json({ success: true, done });
}
