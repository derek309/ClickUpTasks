// Server-only twin of Cockpit.tsx's reconcilePlaybookTasks — same "kept as
// its own copy" reasoning already established by inboundIngest.ts's
// ingestOutboundMessage: the browser version is irreducibly tied to local
// React state (setTasks/setProjects) and the RLS-scoped browser Supabase
// client, so a server route (no React, supabaseAdmin instead) needs its own
// copy rather than trying to share one. Idempotent — safe to call on every
// read/write from the WordPress bridge so a business that's never had its
// Playbook opened in the app yet still gets a complete row set first.
import { supabaseAdmin } from "./supabaseAdmin";
import { PLAYBOOK_ALL_STEPS, playbookProjectId } from "./data";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function reconcilePlaybookTasksServer(clientId: string): Promise<void> {
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

  const toInsert: Record<string, unknown>[] = [];
  const toRetitle: { id: string; title: string }[] = [];
  for (const step of PLAYBOOK_ALL_STEPS) {
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
