// Server-only: daily check that every territory has a task reminding
// someone to send this week's newsletter, so it never just quietly gets
// missed. Fired by /api/cron/newsletter-reminder (see vercel.json) — same
// "run daily, dedupe by a marker + window" shape as playbookCheckinsServer's
// stall check, chosen over the Task.recurrence engine because that one only
// advances when the CURRENT instance is marked done: a missed week would
// leave it silently stuck instead of surfacing a fresh due-dated task.
//
// Territories don't yet have their own `cl_terr_*` client/project rows the
// way an onboarded business does (Cockpit.tsx's ensureTerritoryClient only
// creates them lazily, client-side, the first time someone opens a
// territory's Work tab) — so this ensures both exist first, same
// "idempotent safety net" reasoning as reconcilePlaybookTasksServer.
import { supabaseAdmin } from "./supabaseAdmin";
import { plannerWeekOf, todayIso, formatDue, territoryClientId, newsletterProjectId } from "./data";

const SYSTEM_AUTHOR_ID = "u_claude";

async function ensureTerritoryContainer(territoryId: string, name: string, assignedTo: string[]): Promise<{ clientId: string; projectId: string }> {
  const clientId = territoryClientId(territoryId);
  const projectId = newsletterProjectId(territoryId);

  const { data: existingClient } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!existingClient) {
    await supabaseAdmin.from("clients").insert({
      id: clientId, name, color: "#0ea5e9", type: "client", status: "active_client", assigned_to: assignedTo,
    });
  }

  const { data: existingProject } = await supabaseAdmin.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!existingProject) {
    await supabaseAdmin.from("projects").insert({ id: projectId, client_id: clientId, name: "Newsletter", description: "" });
  }

  return { clientId, projectId };
}

export async function runNewsletterReminderCheck(): Promise<{ created: number }> {
  const { data: territories } = await supabaseAdmin.from("territories").select("id, name, city, state, assigned_to");
  if (!territories?.length) return { created: 0 };

  const weekIso = plannerWeekOf(todayIso()); // this week's Wednesday ship date

  let fallbackAdminId: string | null | undefined; // lazy-resolved, cached across the loop
  const resolveFallbackAdmin = async () => {
    if (fallbackAdminId !== undefined) return fallbackAdminId;
    const { data } = await supabaseAdmin.from("profiles").select("member_id").eq("role", "admin").not("member_id", "is", null).limit(1).maybeSingle();
    fallbackAdminId = (data?.member_id as string | null) ?? null;
    return fallbackAdminId;
  };

  let created = 0;
  for (const t of territories) {
    const assignedTo = (t.assigned_to as string[] | null) ?? [];
    const { clientId, projectId } = await ensureTerritoryContainer(t.id as string, t.name as string, assignedTo);

    const { data: existingReminder } = await supabaseAdmin
      .from("tasks")
      .select("id")
      .eq("client_id", clientId)
      .eq("checkin_kind", "newsletter_due")
      .eq("due", weekIso)
      .limit(1)
      .maybeSingle();
    if (existingReminder) continue; // already have this week's reminder

    const assignee = assignedTo[0] ?? (await resolveFallbackAdmin());
    await supabaseAdmin.from("tasks").insert({
      id: "t_" + crypto.randomUUID(), project_id: projectId, client_id: clientId,
      title: `Newsletter — week of ${formatDue(weekIso)}`,
      description: `This week's newsletter for ${t.city}, ${t.state} ships ${formatDue(weekIso)}. Open the Content Planner to finish this week's picks and content.`,
      status: "todo", priority: "normal", assignee_id: assignee, due: weekIso,
      checkin_kind: "newsletter_due", created_by: SYSTEM_AUTHOR_ID,
    });
    created++;
  }
  return { created };
}
