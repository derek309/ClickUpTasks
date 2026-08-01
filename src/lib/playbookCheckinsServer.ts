// Server-only: daily stall check for the Playbook (Owner Growth Plan). For
// each tracked client actively onboarding/active whose Playbook isn't
// complete, if no step has completed in STALL_DAYS and no stall check-in was
// already created in that same window, create one. Fired by
// /api/cron/playbook-checkins (see vercel.json). Complements the owner-toggle
// route's event-driven "progress" check-ins (which fire on a real
// completion) — this is the other half, catching businesses that have gone
// quiet. Same "server needs its own copy" reasoning as playbookReconcileServer.ts.
import { supabaseAdmin } from "./supabaseAdmin";
import { PLAYBOOK_STEPS, playbookProjectId, todayIso } from "./data";
import { reconcilePlaybookTasksServer } from "./playbookReconcileServer";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Tunable, not structural — adjust here if real usage shows it's too chatty
// or too quiet once this has run for a while.
const STALL_DAYS = 14;
const SYSTEM_AUTHOR_ID = "u_claude";

export async function runPlaybookStallCheck(): Promise<{ created: number }> {
  const cutoff = new Date(Date.now() - STALL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: clients } = await supabaseAdmin
    .from("clients")
    .select("id, name, assigned_to, playbook_last_progress_at")
    .in("status", ["onboarding", "active_client"]);
  if (!clients?.length) return { created: 0 };

  let fallbackAdminId: string | null | undefined; // lazy-resolved, cached across the loop
  const resolveFallbackAdmin = async () => {
    if (fallbackAdminId !== undefined) return fallbackAdminId;
    const { data } = await supabaseAdmin.from("profiles").select("member_id").eq("role", "admin").not("member_id", "is", null).limit(1).maybeSingle();
    fallbackAdminId = (data?.member_id as string | null) ?? null;
    return fallbackAdminId;
  };

  let created = 0;
  for (const client of clients) {
    const lastProgress = client.playbook_last_progress_at as string | null;
    // Never touched (no playbook_last_progress_at yet) counts as stalled too
    // — a client onboarding for 2+ weeks with zero playbook activity is
    // exactly the case this exists to catch.
    if (lastProgress && lastProgress > cutoff) continue;

    await reconcilePlaybookTasksServer(client.id); // idempotent safety net, same as the toggle route
    const { data: stepTasks } = await supabaseAdmin.from("tasks").select("playbook_step_key, status").eq("client_id", client.id).not("playbook_step_key", "is", null);
    const doneKeys = new Set((stepTasks ?? []).filter((t: any) => t.status === "done").map((t: any) => t.playbook_step_key as string));
    const doneCount = PLAYBOOK_STEPS.filter((s) => doneKeys.has(s.key)).length;
    if (doneCount >= PLAYBOOK_STEPS.length) continue; // fully complete — nothing to stall

    const { data: recentCheckin } = await supabaseAdmin
      .from("tasks")
      .select("id")
      .eq("client_id", client.id)
      .eq("checkin_kind", "playbook_stalled")
      .gte("created_at", cutoff)
      .limit(1)
      .maybeSingle();
    if (recentCheckin) continue; // already nudged within the window

    const assignee = ((client.assigned_to as string[] | null) ?? [])[0] ?? (await resolveFallbackAdmin());
    await supabaseAdmin.from("tasks").insert({
      id: "t_" + crypto.randomUUID(), project_id: playbookProjectId(client.id), client_id: client.id,
      title: "Check in — playbook progress has stalled",
      description: `No Playbook activity from ${client.name} in ${STALL_DAYS}+ days. Currently ${doneCount} of ${PLAYBOOK_STEPS.length} steps done. Give them a nudge.`,
      status: "todo", priority: "normal", assignee_id: assignee, due: todayIso(),
      checkin_kind: "playbook_stalled", created_by: SYSTEM_AUTHOR_ID,
    });
    created++;
  }
  return { created };
}
