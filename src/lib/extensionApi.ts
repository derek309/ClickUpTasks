// Shared helpers for the /api/extension/* routes (Gmail Chrome extension).
import { supabaseAdmin } from "./supabaseAdmin";
import { type AuthedUser } from "./serverAuth";
import { WORKSPACE_CLIENT_ID } from "./data";

/** Same visibility rule as visibleClients in Cockpit.tsx: admin sees every
 * client; a VA sees only clients where they have an assigned task or that
 * they're following. Re-derived here since these routes use the
 * service-role client, so RLS doesn't filter this for free. Returns "all"
 * for an admin rather than materializing every client id. */
export async function visibleClientIds(caller: AuthedUser): Promise<"all" | Set<string>> {
  if (caller.role === "admin") return "all";
  const [{ data: myTasks }, { data: clients }] = await Promise.all([
    supabaseAdmin.from("tasks").select("client_id").eq("assignee_id", caller.memberId ?? ""),
    supabaseAdmin.from("clients").select("id, assigned_to").eq("type", "client").like("id", "cl_%").neq("id", WORKSPACE_CLIENT_ID),
  ]);
  const ids = new Set<string>((myTasks ?? []).map((t) => t.client_id));
  for (const c of clients ?? []) {
    if ((c.assigned_to ?? []).includes(caller.memberId)) ids.add(c.id);
  }
  return ids;
}

export async function isClientVisible(caller: AuthedUser, clientId: string): Promise<boolean> {
  const visible = await visibleClientIds(caller);
  return visible === "all" || visible.has(clientId);
}
