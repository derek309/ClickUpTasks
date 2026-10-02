"use client";

// Each person's Inbox settings (the Settings page at the bottom of the Inbox's
// folder list). Saved to their own row (supabase/inbox-prefs.sql) so the phone
// and the laptop agree, with this browser's copy as the instant start and the
// fallback before that table exists. The email signature lives on the profile.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

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
  /** Senders whose pictures always show (lower case addresses). */
  imageSenders: string[];
  /** Always let in (lower case; "@domain" for a whole domain): their email
   *  reaches the Inbox from any Gmail tab, even when it looks automated. */
  allowSenders: string[];
  /** The open conversation's side panel width in pixels, dragged by hand. */
  sideWidth: number;
};

export const DEFAULT_PREFS: InboxPrefs = {
  byDay: false, unreadOnly: false, showClientAndTask: false,
  replies: [
    { name: "Got it", text: "Got it, thanks! I'll take care of this today and let you know when it's done." },
    { name: "Link coming", text: "I'll send you a link to look it over by end of day tomorrow." },
    { name: "Call me", text: "Easier to talk this through. Can you give me a call when you have 5 minutes?" },
  ],
  undoSeconds: 5, aiNudge: true, badge: true, popup: true, sound: false,
  gmailRead: true, gmailArchive: true, imageSenders: [], allowSenders: [], sideWidth: 320,
};

const key = (member: string) => `inboxPrefs:${member}`;

export function useInboxPrefs(member: string) {
  const [prefs, setPrefsState] = useState<InboxPrefs>(() => {
    try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(key(member)) || "{}") }; } catch { return DEFAULT_PREFS; }
  });
  // The saved copy wins over this browser's, once it arrives.
  useEffect(() => {
    let live = true;
    supabase.from("inbox_prefs").select("prefs").eq("member_id", member).maybeSingle().then(({ data }) => {
      if (!live || !data?.prefs) return;
      setPrefsState((p) => {
        const n = { ...p, ...(data.prefs as Partial<InboxPrefs>) };
        try { localStorage.setItem(key(member), JSON.stringify(n)); } catch { /* ignore */ }
        return n;
      });
    });
    return () => { live = false; };
  }, [member]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPrefs = useCallback((patch: Partial<InboxPrefs>) => {
    setPrefsState((p) => {
      const n = { ...p, ...patch };
      try { localStorage.setItem(key(member), JSON.stringify(n)); } catch { /* private window: this session only */ }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        supabase.from("inbox_prefs").upsert({ member_id: member, prefs: n, updated_at: new Date().toISOString() }, { onConflict: "member_id" }).then(() => {});
      }, 600);
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
