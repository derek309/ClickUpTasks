"use client";

// Each person's Inbox settings (the Settings page at the bottom of the Inbox's
// folder list). Saved to their own row (supabase/inbox-prefs.sql) so the phone
// and the laptop agree, with this browser's copy as the instant start and the
// fallback before that table exists. The email signature lives on the profile.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, authedFetch } from "@/lib/supabase";

export type InboxPrefs = {
  byDay: boolean;
  /** Only conversations with something unread (the switch above the list). */
  unreadOnly: boolean;
  showClientAndTask: boolean;
  replies: { name: string; text: string }[];
  undoSeconds: 0 | 5 | 10 | 30;
  /** The Send button sends and archives the conversation (picked from its ▾, Derek 2026-10-07). */
  sendAndArchive?: boolean;
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
  /** The folder list folded to icons only (Derek, 2026-10-02: "to save space"). */
  railCollapsed: boolean;
  /** The open conversation's side panel width in pixels, dragged by hand. */
  sideWidth: number;
  /** Your GoHighLevel Auto BCC Sync address in each sub-account (Derek,
   *  2026-10-05): an email you send is BCC'd there, so it is logged on the
   *  contact in GoHighLevel. GoHighLevel's API doesn't give it out. */
  ghlBcc?: { agency?: string; directory?: string };
  /** The starred calendar the booking window opens on (Derek, 2026-10-05). */
  defaultCalendarId?: string | null;
  /** Booking links folded away under Hidden on the Calendar (calendar ids). */
  hiddenBookingLinks?: string[];
  /** Booking links starred to the top of the Calendar's list (calendar ids). */
  starredBookingLinks?: string[];
  /** Free time on the Calendar is looked for between these, Pacific ("09:00", "17:00"). */
  /** Drafts a Claude chat wrote for you (MCP draft_message), shown at the top
   *  of Drafts until sent or deleted (2026-10-06). Kept here because Inbox
   *  drafts otherwise live only in the browser. */
  queuedDrafts?: QueuedDraft[];
  /** Sidebar sections folded shut: "needs" (Overdue and due today) and "pinned" (2026-10-06). */
  sideFolded?: string[];
  workFrom?: string;
  workTo?: string;
  /** Kinds kept out of this person's Inbox, its count and its pop ups ("email",
   *  "sms", "social", "call"). Still readable on the task (Derek, 2026-10-05:
   *  Michaella only needs team and client chats). */
  hideKinds?: string[];
};

export const DEFAULT_PREFS: InboxPrefs = {
  byDay: false, unreadOnly: false, showClientAndTask: false,
  replies: [
    { name: "Got it", text: "Got it, thanks! I'll take care of this today and let you know when it's done." },
    { name: "Link coming", text: "I'll send you a link to look it over by end of day tomorrow." },
    { name: "Call me", text: "Easier to talk this through. Can you give me a call when you have 5 minutes?" },
  ],
  undoSeconds: 5, aiNudge: true, badge: true, popup: true, sound: false,
  gmailRead: true, gmailArchive: true, imageSenders: [], allowSenders: [], railCollapsed: false, sideWidth: 320,
};

/** threadKey / replyToMessageId: set by MCP draft_email_reply, the
 *  conversation the draft answers. Not read by the Inbox yet, so such a draft
 *  still opens as a new message to the same person. */
export type QueuedDraft = { id: string; kind: "email" | "text"; to: string; name: string; contactId?: string | null; subject?: string; body: string; createdAt: string; by?: string; threadKey?: string; replyToMessageId?: string; gmailDraftId?: string; gmailMailbox?: string };

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
  // Drafts a Claude chat writes arrive while the app is open: picked up each
  // time you come back to the tab.
  useEffect(() => {
    const pick = () => {
      if (document.visibilityState !== "visible") return;
      supabase.from("inbox_prefs").select("prefs").eq("member_id", member).maybeSingle().then(({ data }) => {
        const q = (data?.prefs as Partial<InboxPrefs> | undefined)?.queuedDrafts;
        if (q) setPrefsState((p) => (JSON.stringify(p.queuedDrafts ?? []) === JSON.stringify(q) ? p : { ...p, queuedDrafts: q }));
      });
    };
    document.addEventListener("visibilitychange", pick);
    window.addEventListener("focus", pick);
    // And whenever Drafts is opened (InboxView sends this).
    window.addEventListener("inbox-check-drafts", pick);
    return () => { document.removeEventListener("visibilitychange", pick); window.removeEventListener("focus", pick); window.removeEventListener("inbox-check-drafts", pick); };
  }, [member]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only what changed is saved, on top of the latest saved copy. Saving this
  // tab's whole copy let an older tab put back settings changed elsewhere
  // (Derek, 2026-10-05: his starred booking links and default calendar were
  // wiped when another tab changed something small).
  const pending = useRef<Partial<InboxPrefs>>({});
  const latest = useRef(prefs);
  useEffect(() => { latest.current = prefs; }, [prefs]);
  const save = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const change = pending.current;
      pending.current = {};
      const { data } = await supabase.from("inbox_prefs").select("prefs").eq("member_id", member).maybeSingle();
      const merged = { ...((data?.prefs as Partial<InboxPrefs> | undefined) ?? {}), ...change };
      await supabase.from("inbox_prefs").upsert({ member_id: member, prefs: merged, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
    }, 600);
  }, [member]);
  // A patch, or a function of the newest prefs: a change made after a
  // network round trip (a Claude draft sent or dropped) must start from what
  // is there now, not from the screen it began on (audit 2026-10-10).
  const setPrefs = useCallback((input: Partial<InboxPrefs> | ((prev: InboxPrefs) => Partial<InboxPrefs>)) => {
    const patch = typeof input === "function" ? input(latest.current) : input;
    const { queuedDrafts, ...rest } = patch;
    const before = latest.current.queuedDrafts ?? [];
    pending.current = { ...pending.current, ...rest };
    setPrefsState((p) => {
      const n = { ...p, ...patch };
      try { localStorage.setItem(key(member), JSON.stringify(n)); } catch { /* private window: this session only */ }
      latest.current = n;
      return n;
    });
    if (Object.keys(rest).length) save();
    // Drafts a Claude chat queues change one at a time on the server
    // (supabase/queued-drafts-functions.sql), never as this tab's whole list:
    // a tab that hadn't seen Claude's newest draft erased it (audit
    // 2026-10-10). Without those functions yet, the old whole-list save.
    if (queuedDrafts) {
      const keep = new Set(queuedDrafts.map((d) => d.id));
      const had = new Set(before.map((d) => d.id));
      void Promise.all([
        ...before.filter((d) => !keep.has(d.id)).map((d) => supabase.rpc("queued_draft_remove", { member, draft_id: d.id })),
        ...queuedDrafts.filter((d) => !had.has(d.id)).map((d) => supabase.rpc("queued_draft_put", { member, draft: d })),
      ]).then((rs) => {
        if (!rs.some((r) => r.error)) return;
        pending.current = { ...pending.current, queuedDrafts };
        save();
      });
    }
  }, [member, save]);
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
/** One conversation's draft as the box saves it: half a second after the last
 *  keystroke, or now. Saving now (Send, Discard, Send later, Undo) drops a save
 *  still waiting, which otherwise wrote a just sent text back as a draft when
 *  Enter came within half a second of typing (Derek, 2026-10-07). */
export function draftSaver(member: string, thread: string, delay = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return {
    later(text: string, then?: () => void) {
      cancel();
      timer = setTimeout(() => { timer = null; writeDraft(member, thread, text); then?.(); }, delay);
    },
    now(text: string) { cancel(); writeDraft(member, thread, text); },
    cancel,
  };
}
export function draftKeys(member: string): Set<string> {
  const out = new Set<string>();
  try {
    const prefix = `inboxDraft:${member}:`;
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) out.add(k.slice(prefix.length)); }
  } catch { /* ignore */ }
  return out;
}

export type SetInboxPrefs = (input: Partial<InboxPrefs> | ((prev: InboxPrefs) => Partial<InboxPrefs>)) => void;
/** A Claude draft is done (sent, deleted, or answered another way): its Gmail
 *  copy goes first (the server finds it in the list), then the draft. */
export async function retireQueuedDraft(setPrefs: SetInboxPrefs, id: string, gmailCopy = true) {
  if (gmailCopy) await authedFetch("/api/inbox/claude-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
  setPrefs((prev) => ({ queuedDrafts: (prev.queuedDrafts ?? []).filter((x) => x.id !== id) }));
}
