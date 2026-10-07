// Moving a task to another client: the one set of rules the task page's
// Client dropdown (src/components/cockpit/useLists.ts moveTaskToClient) and
// the MCP's update_task client_id both follow, so the two can't drift.
// Plain JavaScript so the MCP server and the app can both import it.

export const WORKSPACE_CLIENT_ID = "cl_workspace";

/** The contact a task points at once it is on `clientId`. A GoHighLevel
 *  contact client (cl_<contactId>, e.g. cl_ct_ghl_…) is its own contact; the
 *  workspace, Personal and a sub account (an id not starting cl_) have none,
 *  so the old client's person never rides along.
 *  @param {string} clientId
 *  @returns {string | null} */
export function contactForMovedTask(clientId) {
  return clientId.startsWith("cl_") && clientId !== WORKSPACE_CLIENT_ID ? clientId.slice(3) : null;
}

/** The list a moved task lands on: the named one when it belongs to the new
 *  client, otherwise its "Tasks" list, otherwise its first list. Null means
 *  the client has no list yet and a "Tasks" one has to be made.
 *  @param {{ id: string; clientId: string; name?: string }[]} lists
 *  @param {string} clientId
 *  @param {string | null | undefined} targetListId
 *  @returns {string | null} */
export function listForMovedTask(lists, clientId, targetListId) {
  const own = lists.filter((l) => l.clientId === clientId);
  return (targetListId && own.find((l) => l.id === targetListId)?.id)
    || own.find((l) => (l.name ?? "").trim().toLowerCase() === "tasks")?.id || own[0]?.id || null;
}

/** The task's Changes feed line for the move.
 *  @param {string} fromName @param {string} toName @param {string | null | undefined} listName */
export function clientMoveLine(fromName, toName, listName) {
  return `moved from ${fromName} to ${toName}${listName ? ` (${listName})` : ""}`;
}
