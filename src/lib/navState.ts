// Deep-link URL state, lifted out of Cockpit.tsx.
//
// Pure string in, plain object out, with no React and no component state, so
// it can be read on its own and tested without mounting five thousand lines
// of app around it. Everything below is exactly as it was.

// --- Deep-link URL state ----------------------------------------------------
// The whole app lives on "/", so we encode what you're looking at into the
// query string: shareable links, refresh-safe, and back/forward navigation.
//   ?view=work|clients|personal|settings   the special boards
//   ?view=inbox[&dm=<userId>]              team chat, optionally a DM thread
//   ?client=<id>[&project=<id>]   a client (optionally scoped to one project)
//   ?task=<id>                    the task drawer (layers over any of the above)
export type NavState = { view: "work" | "personal" | "inbox" | "clients" | "projects" | "settings" | null; client: string; project: string | null; task: string | null; clientTab: "tasks" | "chat" | null; vaultFolder: string | null; dm: string | null };
export function buildSearch(s: NavState): string {
  const p = new URLSearchParams();
  if (s.view) {
    p.set("view", s.view);
    if (s.view === "inbox" && s.dm) p.set("dm", s.dm);
  } else if (s.client !== "all") {
    p.set("client", s.client);
    if (s.project) p.set("project", s.project);
    // "tasks" is the default sub-tab — only encode it when it differs, so
    // every pre-existing shared link (no ?tab= at all) still keeps working.
    if (s.clientTab && s.clientTab !== "tasks") p.set("tab", s.clientTab);
    if (s.vaultFolder) p.set("folder", s.vaultFolder);
  }
  if (s.task) p.set("task", s.task);
  const q = p.toString();
  return q ? `?${q}` : "";
}
export function parseSearch(search: string): NavState {
  const p = new URLSearchParams(search);
  const v = p.get("view");
  const tab = p.get("tab");
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
  };
}

// Number-key shortcuts for the top-level views, in sidebar order. Shown as
// a hint on each sidebar item and handled by the keydown effect below.
export const NAV_KEY_VIEWS: Record<string, "dashboard" | "clients" | "projects" | "personal" | "teamchat"> = {
  "1": "dashboard",
  "2": "teamchat",
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

// Deep link straight to Team Chat, for notification emails. ?view=inbox is
// what parseUrl maps onto inboxView (see NavState above).
export const TEAM_CHAT_LINK = "?view=inbox";