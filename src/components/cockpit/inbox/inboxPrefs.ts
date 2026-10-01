"use client";

// Each person's Inbox settings (the Settings page at the bottom of the Inbox's
// folder list). Kept in this browser for now; the email signature is the one
// setting shared with the rest of the app and lives on the profile.
import { useCallback, useState } from "react";

export type InboxPrefs = {
  byDay: boolean;
  /** Only conversations with something unread (the switch above the list). */
  unreadOnly: boolean;
  showClientAndTask: boolean;
  replies: { name: string; text: string }[];
  undoSeconds: 0 | 5 | 10 | 30;
  aiNudge: boolean;
  badge: boolean;
  popup: boolean;
  sound: boolean;
  /** Opening a message marks it read in Gmail; Mark as unread puts it back. */
  gmailRead: boolean;
  /** Done archives the email in Gmail (out of its inbox, never deleted). */
  gmailArchive: boolean;
};

export const DEFAULT_PREFS: InboxPrefs = {
  byDay: false, unreadOnly: false, showClientAndTask: false,
  replies: [
    { name: "Got it", text: "Got it, thanks! I'll take care of this today and let you know when it's done." },
    { name: "Link coming", text: "I'll send you a link to look it over by end of day tomorrow." },
    { name: "Call me", text: "Easier to talk this through. Can you give me a call when you have 5 minutes?" },
  ],
  undoSeconds: 5, aiNudge: true, badge: true, popup: true, sound: false,
  gmailRead: true, gmailArchive: true,
};

const key = (member: string) => `inboxPrefs:${member}`;

export function useInboxPrefs(member: string) {
  const [prefs, setPrefsState] = useState<InboxPrefs>(() => {
    try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(key(member)) || "{}") }; } catch { return DEFAULT_PREFS; }
  });
  const setPrefs = useCallback((patch: Partial<InboxPrefs>) => {
    setPrefsState((p) => {
      const n = { ...p, ...patch };
      try { localStorage.setItem(key(member), JSON.stringify(n)); } catch { /* private window: this session only */ }
      return n;
    });
  }, [member]);
  return { prefs, setPrefs };
}

/** Drafts, one per conversation, saved as you type. */
export const draftKey = (member: string, thread: string) => `inboxDraft:${member}:${thread}`;
export function readDraft(member: string, thread: string): string {
  try { return localStorage.getItem(draftKey(member, thread)) ?? ""; } catch { return ""; }
}
export function writeDraft(member: string, thread: string, text: string) {
  try { if (text.trim()) localStorage.setItem(draftKey(member, thread), text); else localStorage.removeItem(draftKey(member, thread)); } catch { /* ignore */ }
}
export function draftKeys(member: string): Set<string> {
  const out = new Set<string>();
  try {
    const prefix = `inboxDraft:${member}:`;
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) out.add(k.slice(prefix.length)); }
  } catch { /* ignore */ }
  return out;
}
