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
  // whole-client context out of scope, so it's forced false there too).
  showGrowthPlan: boolean;
  // Whether the portal lists the whole account rather than only what involves
  // the client. Unlike the two flags above this is NOT forced false for a
  // project-scoped token: that token's queries are already pinned to one
  // project, so honouring it there widens the view within that list only,
  // never past it.
  showAllTasks: boolean;
  // Set only when `token` matched a project's own share_token. Every caller
  // MUST additionally filter its tasks/projects queries by this id when set.
  projectId: string | null;
};

// A trashed client or project (see supabase/soft-delete.sql) resolves to null,
// exactly like an unknown token: trash is meant to be reversible for the team,
// not a state the public link can still see into. Callers must also exclude
// trashed tasks themselves, since a live client can have trashed tasks.
export async function resolveWaitingToken(token: string): Promise<WaitingScope | null> {
  const { data: project } = await supabaseAdmin.from("projects").select("id, client_id, deleted_at").eq("share_token", token).maybeSingle();
  if (project) {
    if (project.deleted_at) return null;
    const { data: client } = await supabaseAdmin.from("clients")
      .select("id, name, assigned_to, linked_contact_id, portal_shows_all_tasks, deleted_at")
      .eq("id", project.client_id as string).maybeSingle();
    if (!client || client.deleted_at || client.id === PERSONAL_CLIENT_ID) return null;
    return {
      clientId: client.id as string,
      clientName: client.name as string,
      assignedTo: (client.assigned_to as string[] | null) ?? [],
      linkedContactId: (client.linked_contact_id as string | null) ?? null,
      canRequestNewTasks: false,
      showGrowthPlan: false,
      showAllTasks: client.portal_shows_all_tasks === true,
      projectId: project.id as string,
    };
  }
  const { data: client } = await supabaseAdmin.from("clients")
    .select("id, name, assigned_to, can_request_new_tasks, show_growth_plan, portal_shows_all_tasks, linked_contact_id, deleted_at")
    .eq("share_token", token).maybeSingle();
  if (!client || client.deleted_at || client.id === PERSONAL_CLIENT_ID) return null;
  return {
    clientId: client.id as string,
    clientName: client.name as string,
    assignedTo: (client.assigned_to as string[] | null) ?? [],
    linkedContactId: (client.linked_contact_id as string | null) ?? null,
    canRequestNewTasks: client.can_request_new_tasks === true,
    showGrowthPlan: client.show_growth_plan === true,
    showAllTasks: client.portal_shows_all_tasks === true,
    projectId: null,
  };
}
