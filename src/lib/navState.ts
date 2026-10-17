// Deep-link URL state, lifted out of Cockpit.tsx.
//
// Pure string in, plain object out, with no React and no component state, so
// it can be read on its own and tested without mounting five thousand lines
// of app around it. Everything below is exactly as it was.

import { PERSONAL_CLIENT_ID, PERSONAL_PROJECT_ID } from "./data";

// --- Deep-link URL state ----------------------------------------------------
// The whole app lives on "/", so we encode what you're looking at into the
// query string: shareable links, refresh-safe, and back/forward navigation.
//   ?view=work|clients|personal|settings   the special boards
//   ?view=inbox&dm=<userId>                a DM thread
//   ?view=mail                             the Inbox (email, texts, task chats)
//   ?view=reminders                        Reminders, every reminder to a client (2026-10-15)
//   ?view=mail&thread=<key>                one conversation in it, a link to
//                                          paste into a Claude chat (2026-10-09)
//   ?client=<id>[&project=<id>]   a client (its Lists), or one of its lists
//   ?client=<id>&tab=all          a client's All tasks, across its lists
//   ?assignee=<id>|all            All Tasks scoped to one person or everyone
//                                  (the default "mine" is never encoded)
//   ?sub=reviews                  My Work showing what is out with a client
//   ?sub=drafts                   My Work showing what is written and unsent
//   ?sub=completed                All Tasks showing the completed log
//   ?task=<id>                    the task drawer (layers over any of the above)
//
// sub is the second half of a view. Both of these were reachable only by
// clicking, and both were where the answer to a question lived: "here is my
// day" and "here is what we finished" could not be linked, bookmarked or sent
// to anyone, and the completed log had no way in at all except landing on All
// Tasks and pressing its button.
export type NavSub = "reviews" | "drafts" | "completed";
export type NavState = { view: "work" | "personal" | "inbox" | "mail" | "reminders" | "calendar" | "clients" | "projects" | "settings" | null; client: string; project: string | null; task: string | null; clientTab: "tasks" | "chat" | "all" | null; vaultFolder: string | null; dm: string | null; thread?: string | null; assignee: string | null; sub: NavSub | null };
export function buildSearch(s: NavState): string {
  const p = new URLSearchParams();
  if (s.view) {
    p.set("view", s.view);
    if (s.view === "inbox" && s.dm) p.set("dm", s.dm);
    if (s.view === "mail" && s.thread) p.set("thread", s.thread);
    // Only My Work has these halves; anywhere else the parameter would be noise.
    if (s.view === "work" && (s.sub === "reviews" || s.sub === "drafts")) p.set("sub", s.sub);
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
    view: v === "work" || v === "personal" || v === "inbox" || v === "mail" || v === "reminders" || v === "calendar" || v === "clients" || v === "projects" || v === "settings" ? v : null,
    client: p.get("client") ?? "all",
    project: p.get("project"),
    task: p.get("task"),
    // "vault" was a separate tab pre-merge — old bookmarked/shared links
    // still resolve it into Journal (now the only place attachments live).
    // "all" is All tasks on a client's page (2026-10-17): every task across
    // its lists. Without it the page opens on its Lists.
    clientTab: tab === "chat" || tab === "vault" ? "chat" : tab === "all" ? "all" : null,
    vaultFolder: p.get("folder"),
    dm: p.get("dm"),
    thread: p.get("thread"),
    assignee: p.get("assignee"),
    // Plan and Next steps were removed (2026-09-28); an old ?sub=plan link
    // lands on Work.
    sub: sub === "reviews" || sub === "drafts" || sub === "completed" ? sub : null,
  };
}

// The sidebar's Tasks link. All Tasks for you writes nothing to the URL, but a
// bare "/" opens a VA on Clients (their default), so a Tasks link opened in a
// new tab spells it out; the app tidies it back to "/" once it's open.
export const ALL_TASKS_HREF = "/?assignee=mine";

// Sidebar rows are real links so right click, ⌘ or Ctrl click, middle click
// and Shift click open them in a new tab or window the browser's own way. Only
// a plain left click is the app's, moving in place without a reload.
export function isPlainLeftClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

// Links for rows on a page (client cards, list rows, task rows), so they open
// in a new tab the same way the sidebar's do (Derek, 2026-10-14). Each is the
// address that view lives at, built by buildSearch so it reads back exactly.
const NO_NAV: NavState = { view: null, client: "all", project: null, task: null, clientTab: null, vaultFolder: null, dm: null, assignee: null, sub: null };
const href = (s: Partial<NavState>) => `/${buildSearch({ ...NO_NAV, ...s })}`;

/** A client's task list. */
export function clientHref(clientId: string): string {
  return href({ client: clientId });
}

/** One list inside a client. The Personal list is its own view. */
export function listHref(clientId: string, projectId: string): string {
  if (projectId === PERSONAL_PROJECT_ID) return href({ view: "personal" });
  return href({ client: clientId, project: projectId });
}

/** A task, open over its client's list, the way the app writes it when a task
 *  opens there. A personal to-do opens over Personal; a task with no client
 *  opens over All Tasks. */
export function taskHref(task: { id: string; clientId?: string | null }): string {
  if (task.clientId === PERSONAL_CLIENT_ID) return href({ view: "personal", task: task.id });
  return href({ client: task.clientId || "all", task: task.id });
}

// Number-key shortcuts for the top-level views, in sidebar order. Shown as
// a hint on each sidebar item and handled by the keydown effect below.
// The same order as ⌘K's Go to (Derek, 2026-10-05: "match the number keys"):
// 1 Inbox, 2 Clients, 3 Tasks, 4 Projects, 5 Personal; All clients keeps 6.
export const NAV_KEY_VIEWS: Record<string, "dashboard" | "alltasks" | "clients" | "projects" | "personal" | "inbox"> = {
  "1": "inbox",
  "2": "dashboard",
  "3": "alltasks",
  "4": "projects",
  "5": "personal",
  "6": "clients",
};

// The first half of a deep link to a direct message, for notification emails:
// it is always followed by &dm=<memberId>. Named for Team Chat, which this app
// no longer has; ?view=inbox on its own renders nothing, so never send it
// alone. parseUrl maps view=inbox onto inboxView (see NavState above).
export const DM_LINK_PREFIX = "?view=inbox";