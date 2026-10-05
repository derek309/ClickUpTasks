// Mac or Windows, for the shortcut keys the app shows (Derek, 2026-10-05:
// Michaella is on Windows and couldn't find search). Every shortcut already
// listens for Ctrl as well as Command; this is only how they are written.
export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");

/** "⌘" on a Mac, "Ctrl" elsewhere. */
export const modKey = (): string => (isMac() ? "⌘" : "Ctrl");

/** A shortcut as the computer writes it: "⌘K" on a Mac, "Ctrl+K" on Windows. */
export const shortcut = (key: string): string => (isMac() ? `⌘${key}` : `Ctrl+${key}`);
