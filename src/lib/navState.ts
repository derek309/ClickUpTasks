// Deep-link URL state, lifted out of Cockpit.tsx.
//
// Pure string in, plain object out, with no React and no component state, so
// it can be read on its own and tested without mounting five thousand lines
// of app around it. Everything below is exactly as it was.

// --- Deep-link URL state ----------------------------------------------------
// The whole app lives on "/", so we encode what you're looking at into the
// query string: shareable links, refresh-safe, and back/forward navigation.
//   ?view=work|clients|personal|settings   the special boards
//   ?view=inbox&dm=<userId>                a DM thread
//   ?client=<id>[&project=<id>]   a client (optionally scoped to one project)
//   ?assignee=<id>|all            All Tasks scoped to one person or everyone
//                                  (the default "mine" is never encoded)
//   ?sub=plan                     My Work showing Plan instead of Work
//   ?sub=reviews                  My Work showing what is out with a client
//   ?sub=completed                All Tasks showing the completed log
//   ?task=<id>                    the task drawer (layers over any of the above)
//
// sub is the second half of a view. Both of these were reachable only by
// clicking, and both were where the answer to a question lived: "here is my
// day" and "here is what we finished" could not be linked, bookmarked or sent
// to anyone, and the completed log had no way in at all except landing on All
// Tasks and pressing its button.
export type NavSub = "plan" | "reviews" | "completed";
export type NavState = { view: "work" | "personal" | "inbox" | "clients" | "projects" | "settings" | null; client: string; project: string | null; task: string | null; clientTab: "tasks" | "chat" | null; vaultFolder: string | null; dm: string | null; assignee: string | null; sub: NavSub | null };
export function buildSearch(s: NavState): string {
  const p = new URLSearchParams();
  if (s.view) {
    p.set("view", s.view);
    if (s.view === "inbox" && s.dm) p.set("dm", s.dm);
    // Only My Work has these halves; anywhere else the parameter would be noise.
    if (s.view === "work" && (s.sub === "plan" || s.sub === "reviews")) p.set("sub", s.sub);
  } else if (s.client !== "all") {
    p.set("client", s.client);
    if (s.project) p.set("project", s.project);
    // "tasks" is the default sub-tab — only encode it when it differs, so
    // every pre-existing shared link (no ?tab= at all) still keeps working.
    if (s.clientTab && s.clientTab !== "tasks") p.set("tab", s.clientTab);
    if (s.vaultFolder) p.set("folder", s.vaultFolder);
  } else if (s.assignee && s.assignee !== "mine") {
    // All Tasks with nothing else selected still carries meaning — WHOSE
    // tasks it's showing — and that's exactly what a shared link is for
    // (Derek, 2026-09-09: "when I click on all tasks I need a real link so
    // I can share it"). "mine" is the default every fresh visit already
    // lands on, so it's the one value worth leaving off the URL.
    p.set("assignee", s.assignee);
  }
  // All Tasks, whichever assignee it is scoped to, including the default one
  // that writes no assignee of its own.
  if (!s.view && s.client === "all" && s.sub === "completed") p.set("sub", "completed");
  if (s.task) p.set("task", s.task);
  const q = p.toString();
  return q ? `?${q}` : "";
}
export function parseSearch(search: string): NavState {
  const p = new URLSearchParams(search);
  const v = p.get("view");
  const tab = p.get("tab");
  const sub = p.get("sub");
  return {
    view: v === "work" || v === "personal" || v === "inbox" || v === "clients" || v === "projects" || v === "settings" ? v : null,
    client: p.get("client") ?? "all",
    project: p.get("project"),
    task: p.get("task"),
    // "vault" was a separate tab pre-merge — old bookmarked/shared links
    // still resolve it into Journal (now the only place attachments live).
    clientTab: tab === "chat" || tab === "vault" ? "chat" : null,
    vaultFolder: p.get("folder"),
    dm: p.get("dm"),
    assignee: p.get("assignee"),
    sub: sub === "plan" || sub === "reviews" || sub === "completed" ? sub : null,
  };
}

// Number-key shortcuts for the top-level views, in sidebar order. Shown as
// a hint on each sidebar item and handled by the keydown effect below.
export const NAV_KEY_VIEWS: Record<string, "dashboard" | "alltasks" | "clients" | "projects" | "personal"> = {
  "1": "dashboard",
  "2": "alltasks",
  "3": "clients",
  "4": "projects",
  "5": "personal",
};

// Titles longer than this get quietly rewritten by AI after the task is
// created (see maybeCleanupTaskTitle). 80 characters is roughly two typical
// sentences: a genuine task title almost never runs that long, so anything
// past it is a sign the whole thought got typed into the title box. It also
// matches the "under 80 characters" title the Gmail extension's enrich prompt
// already asks Gemini for, so both paths agree on what a good title looks like.
export const LONG_TITLE_THRESHOLD = 80;

// The first half of a deep link to a direct message, for notification emails:
// it is always followed by &dm=<memberId>. Named for Team Chat, which this app
// no longer has; ?view=inbox on its own renders nothing, so never send it
// alone. parseUrl maps view=inbox onto inboxView (see NavState above).
export const DM_LINK_PREFIX = "?view=inbox";