// Builds clickuptasks:// deep links for the local desktop-helper
// (desktop-helper/, a plain Node script — see its README) instead of
// Anthropic's claude://code/new. claude:// can only ever start a
// brand-new session — no resume-by-name, and no way for a launcher to
// learn the session id it created. clickuptasks:// hands off to
// desktop-helper/handler.mjs, which resumes a NAMED session
// (cut-t-<taskId> / cut-c-<clientId>[-p-<projectId>]) if one already
// exists for that scope, or creates it on first click — so re-clicking
// the same task days later picks the conversation back up instead of
// starting cold every time.
//
// The URL carries only ids, never the local repo path or any free-text
// title — the helper is the sole owner of the repo path
// (~/.clickuptasks-helper.json, set once via desktop-helper/install-mac.mjs
// or install-windows.mjs) and builds the whole seed prompt itself from the
// ids via the clickuptasks MCP tools.
export function claudeWorkUrl(scope: { task: string } | { client: string; project?: string | null }): string {
  const q = new URLSearchParams();
  if ("task" in scope) {
    q.set("task", scope.task);
  } else {
    q.set("client", scope.client);
    if (scope.project) q.set("project", scope.project);
  }
  return `clickuptasks://work?${q.toString()}`;
}
