// Server-only twin of Cockpit.tsx's reconcilePlaybookTasks — same "kept as
// its own copy" reasoning already established by inboundIngest.ts's
// ingestOutboundMessage: the browser version is irreducibly tied to local
// React state (setTasks/setProjects) and the RLS-scoped browser Supabase
// client, so a server route (no React, supabaseAdmin instead) needs its own
// copy rather than trying to share one. Idempotent — safe to call on every
// read/write from the WordPress bridge so a business that's never had its
// Playbook opened in the app yet still gets a complete row set first.
import { supabaseAdmin } from "./supabaseAdmin";
import { playbookStepsForClient, playbookProjectId, WORKSPACE_CLIENT_ID, PERSONAL_CLIENT_ID } from "./data";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function reconcilePlaybookTasksServer(clientId: string): Promise<void> {
  // Playbook is a real-business concept — the Workspace/Personal pseudo-
  // clients have no growth plan to track. Guarded here (the actual
  // create-the-rows choke point) rather than just at each caller, since a
  // future caller passing either id by accident would otherwise recreate
  // the exact "Playbook" project + step tasks under cl_workspace that had
  // to be cleaned up once already (see playbookCheckinsServer.ts).
  if (clientId === WORKSPACE_CLIENT_ID || clientId === PERSONAL_CLIENT_ID) return;
  const pbProjectId = playbookProjectId(clientId);
  const { data: existingProject } = await supabaseAdmin.from("projects").select("id").eq("id", pbProjectId).maybeSingle();
  if (!existingProject) {
    await supabaseAdmin.from("projects").insert({ id: pbProjectId, client_id: clientId, name: "Playbook", description: "" });
  }

  const { data: existingTasks } = await supabaseAdmin
    .from("tasks")
    .select("*")
    .eq("client_id", clientId)
    .not("playbook_step_key", "is", null);
  const byKey = new Map((existingTasks ?? []).map((t: any) => [t.playbook_step_key as string, t]));

  // Same A2P/email-domain gate as the browser copy — without it this route
  // would quietly re-create, on the next WordPress bridge call, exactly the
  // rows the app just stopped making.
  const { data: clientRow } = await supabaseAdmin.from("clients").select("does_a2p").eq("id", clientId).maybeSingle();
  const steps = playbookStepsForClient((clientRow as any)?.does_a2p === true);

  const toInsert: Record<string, unknown>[] = [];
  const toRetitle: { id: string; title: string }[] = [];
  for (const step of steps) {
    const existing = byKey.get(step.key);
    if (!existing) {
      toInsert.push({
        id: "t_" + crypto.randomUUID(), project_id: pbProjectId, client_id: clientId, title: step.label, description: "",
        status: "todo", priority: "none", assignee_id: null, contact_id: clientId.slice(3), due: null,
        recurrence: step.recurring ? "monthly" : "none", playbook_step_key: step.key, created_by: null,
      });
    } else if (existing.title !== step.label) {
      toRetitle.push({ id: existing.id, title: step.label });
    }
  }

  if (toInsert.length) await supabaseAdmin.from("tasks").insert(toInsert);
  for (const r of toRetitle) await supabaseAdmin.from("tasks").update({ title: r.title, updated_by: null }).eq("id", r.id);
}

// The MCP server's own synthetic roster identity (see data.ts's
// PROTECTED_USER_IDS) — reused as the author of an automated, no-human-actor
// comment, same convention planner-interest/route.ts and the playbook toggle
// route already use for system-posted activity.
const SYSTEM_AUTHOR_ID = "u_claude";

/** Marks one SALES_STAGE_STEPS step done for a client, from a server-side
 * automation trigger (a claim, an invite reply) rather than a rep checking a
 * box by hand. Reconciles first so the task row exists even on a client's
 * very first touch, no-ops if already done (so a replayed webhook can't
 * double-log), and leaves an audit comment naming what triggered it. Scoped
 * to exactly the one stepKey passed in — deliberately does not cascade-
 * complete earlier stages, since a business that self-claims without ever
 * being contacted is a real, valid path (02-SOP-Sales-Process.md), not a gap
 * to paper over by backfilling stages that never actually happened. Returns
 * false only when the client has no matching step task at all (an unknown
 * stepKey) — already-done is a success, not a failure, so callers can await
 * this without an extra status check. */
export async function completePlaybookStepServer(clientId: string, stepKey: string, reason: string): Promise<boolean> {
  await reconcilePlaybookTasksServer(clientId);
  const { data: task } = await supabaseAdmin.from("tasks").select("id, status").eq("client_id", clientId).eq("playbook_step_key", stepKey).maybeSingle();
  if (!task) return false;
  if ((task as any).status === "done") return true;
  const comment = { id: "cm_" + crypto.randomUUID(), authorId: SYSTEM_AUTHOR_ID, body: reason, at: new Date().toISOString(), kind: "event" };
  await supabaseAdmin.rpc("append_comment", { task_id: (task as any).id, comment });
  await supabaseAdmin.from("tasks").update({ status: "done", updated_by: null }).eq("id", (task as any).id);
  // Same stall-check signal the toggle route bumps — "quiet because just
  // moved forward" reads differently from "quiet because stuck," regardless
  // of whether the forward motion was an owner's own click or a sales stage.
  await supabaseAdmin.from("clients").update({ playbook_last_progress_at: new Date().toISOString() }).eq("id", clientId);
  return true;
}
