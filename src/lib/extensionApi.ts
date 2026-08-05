// Shared helpers for the /api/extension/* routes (Gmail Chrome extension),
// plus the caller-visibility gate the /api/ai/* and /api/ghl/* routes reuse.
import { supabaseAdmin } from "./supabaseAdmin";
import { type AuthedUser } from "./serverAuth";
import { resolveTrackedClientId } from "./ghlConversationTask";
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

/** Same rule as isClientVisible, but for the /api/ghl/* proxy routes, which
 * receive a caller-supplied `ghlContactId` (+ locationId) and nothing else —
 * so without this a signed-in VA could point them at ANY sub-account's
 * contact and read or write that client's GoHighLevel data. Resolves the
 * local contact the GHL id belongs to, maps it to the tracked client that
 * represents it (the same cl_<contactId> / linked_contact_id / merged
 * resolution every inbound path already uses), then applies the ordinary
 * visibility rule.
 *
 * Admins short-circuit to true, matching how /api/ghl/message already skips
 * its contact-ownership check for them: they may act on any client, and on a
 * contact that hasn't synced into `contacts` yet. For everyone else an
 * unknown ghlContactId is a denial, not a pass — fail closed. */
export async function isGhlContactVisible(caller: AuthedUser, ghlContactId: string): Promise<boolean> {
  if (caller.role === "admin") return true;
  const { data: contact } = await supabaseAdmin.from("contacts").select("id, client_id").eq("ghl_contact_id", ghlContactId).maybeSingle();
  if (!contact) return false;
  const clientId = await resolveTrackedClientId(contact.id as string, contact.client_id as string);
  return isClientVisible(caller, clientId);
}
