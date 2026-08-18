import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { PERSONAL_CLIENT_ID } from "@/lib/data";

// Every /api/waiting/[token]/* route used to repeat its own
// `.eq("share_token", token)` lookup on `clients` independently — six copies
// of the same access-control logic, easy for one to drift out of sync with
// the others. Centralized here specifically because this feature adds a
// SECOND kind of token (a project/list token, see
// supabase/project-share-token.sql) that every route needs to recognize the
// same way: a project token proves nothing about the rest of that client,
// so every query downstream must also scope to `projectId`, not just
// `clientId` — the whole point of "share just this one list."
export type WaitingScope = {
  clientId: string;
  clientName: string;
  assignedTo: string[];
  linkedContactId: string | null;
  // A list link never grants raising brand-new tasks (there's no single
  // project to file it under that the visitor should be trusted to name) —
  // forced false here rather than read off the client row when projectId is set.
  canRequestNewTasks: boolean;
  // Whether the "Your growth plan" progress card is client-visible at all —
  // same reasoning as canRequestNewTasks above (a project-scoped token is
  // whole-client Playbook out of scope, so it's forced false there too).
  showGrowthPlan: boolean;
  // Set only when `token` matched a project's own share_token. Every caller
  // MUST additionally filter its tasks/projects queries by this id when set.
  projectId: string | null;
};

export async function resolveWaitingToken(token: string): Promise<WaitingScope | null> {
  const { data: project } = await supabaseAdmin.from("projects").select("id, client_id").eq("share_token", token).maybeSingle();
  if (project) {
    const { data: client } = await supabaseAdmin.from("clients")
      .select("id, name, assigned_to, linked_contact_id")
      .eq("id", project.client_id as string).maybeSingle();
    if (!client || client.id === PERSONAL_CLIENT_ID) return null;
    return {
      clientId: client.id as string,
      clientName: client.name as string,
      assignedTo: (client.assigned_to as string[] | null) ?? [],
      linkedContactId: (client.linked_contact_id as string | null) ?? null,
      canRequestNewTasks: false,
      showGrowthPlan: false,
      projectId: project.id as string,
    };
  }
  const { data: client } = await supabaseAdmin.from("clients")
    .select("id, name, assigned_to, can_request_new_tasks, show_growth_plan, linked_contact_id")
    .eq("share_token", token).maybeSingle();
  if (!client || client.id === PERSONAL_CLIENT_ID) return null;
  return {
    clientId: client.id as string,
    clientName: client.name as string,
    assignedTo: (client.assigned_to as string[] | null) ?? [],
    linkedContactId: (client.linked_contact_id as string | null) ?? null,
    canRequestNewTasks: client.can_request_new_tasks === true,
    showGrowthPlan: client.show_growth_plan === true,
    projectId: null,
  };
}
