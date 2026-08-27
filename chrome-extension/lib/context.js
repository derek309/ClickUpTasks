// Pure helpers behind the Clipper's work contexts — a saved set of tabs for a
// client, and optionally for one task under it.
//
// Deliberately free of every chrome.* call so this module can be unit tested
// in the app's own vitest run. The fiddly, easy-to-get-wrong parts of the
// feature (what counts as the same URL, what must never be captured, which
// tabs a task inherits from its client) all live here rather than tangled
// into DOM and extension-API code that nothing can exercise.

/** Same tab, for dedupe purposes? Origin plus pathname, ignoring a trailing
 *  slash, the hash, and the query. Two GHL deep links that differ only by a
 *  `?tab=` are the same tab to a human, and a hash is usually in-page state.
 *  Returns the raw string for anything unparseable so a junk entry can still
 *  be compared with itself rather than collapsing all junk together. */
export function normalizeUrl(url) {
  if (typeof url !== "string") return "";
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Can this URL be reopened later? chrome:// and friends either can't be
 *  scripted or won't restore into a useful page, and a file:// path is
 *  meaningless on another machine. */
export function isCapturable(url) {
  if (typeof url !== "string" || !url) return false;
  return /^https?:\/\//i.test(url);
}

/** Does this look like a sign-in page rather than the page you meant?
 *  Saving one is the classic way a work context quietly rots: the tab 302s
 *  to a login screen, you save that, and the real URL is gone. Used to
 *  pre-untick rows at capture time, never to block them outright — sometimes
 *  a login page IS the thing you want open. */
export function isSignInUrl(url) {
  if (typeof url !== "string") return false;
  const u = url.toLowerCase();
  if (/(^|\/\/)accounts\.google\.com/.test(u)) return true;
  if (/\/wp-login\.php/.test(u)) return true;
  if (/\/(login|signin|sign-in|auth)(\/|\?|$)/.test(u)) return true;
  if (/[?&](redirect_to|redirect_uri|returnurl|next)=/.test(u)) return true;
  return false;
}

/** A task's tabs sit on top of its client's, they don't replace them: the
 *  GHL sub-account and the WP admin belong to every task for that client,
 *  while the Figma file belongs to one. Baseline first so the stable tabs
 *  keep a stable position in the group, then anything the task adds that
 *  isn't already there. */
export function layerContexts(baseline = [], taskTabs = []) {
  const out = [];
  const seen = new Set();
  for (const tab of [...baseline, ...taskTabs]) {
    if (!tab || !isCapturable(tab.url)) continue;
    const key = normalizeUrl(tab.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: tab.url, title: typeof tab.title === "string" ? tab.title : "", pinned: !!tab.pinned });
  }
  return out;
}

/** Turn a window's live tabs into savable rows, dropping what can't be
 *  reopened and flagging what probably shouldn't be. The caller shows these
 *  for review — nothing is ever saved without being seen. */
export function prepareCapture(tabs = []) {
  // Deduped: people keep the same page open in two tabs all the time (a
  // second ClickUpTasks, a stray copy of the client's WP admin). Saving both
  // means reopening both forever, so collapse them here, keeping the first.
  const seen = new Set();
  return tabs
    .filter((t) => {
      if (!t || !isCapturable(t.url)) return false;
      const key = normalizeUrl(t.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t) => ({
      url: t.url,
      title: typeof t.title === "string" ? t.title : "",
      pinned: !!t.pinned,
      // Pre-unticked, with the reason surfaced in the UI.
      keep: !isSignInUrl(t.url),
      signIn: isSignInUrl(t.url),
    }));
}

/** Storage key for one scope. task id is part of the key, so a client's
 *  baseline and each of its tasks are separate rows that never collide. */
export function contextKey(clientId, taskId) {
  return `${clientId}::${taskId || ""}`;
}

// Above this many tabs, opening a context is disruptive enough to be worth a
// word of warning at save time; the server rejects outright past HARD_MAX.
export const SOFT_MAX_TABS = 15;
export const HARD_MAX_TABS = 60;
