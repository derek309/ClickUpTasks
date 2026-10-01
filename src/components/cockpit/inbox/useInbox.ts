"use client";

// Loads the Inbox and keeps it current: your own Gmail, GoHighLevel
// conversations assigned to you or to nobody, and the portal chats on your
// tasks, with your own read / snooze / done state on each (supabase/inbox.sql).
// It reads its own rows rather than the app's main load, which leaves out
// anything with no client, and it folds in the live messages the app already
// receives so a new one shows up without a refetch.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, authedFetch } from "@/lib/supabase";
import { rowToMessage } from "@/lib/db";
import type { Message, Task } from "@/lib/data";
import { threadKeyOf as thKey, isBlocked } from "@/lib/inbox";
import { buildThreads, type GhlConv, type InboxState, type InboxThread } from "./inboxModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DAYS = 30;
const CHUNK = 150;

export type UseInboxDeps = {
  meMemberId: string;
  isAdmin: boolean;
  /** The app's live messages (realtime inserts land here first). */
  liveMessages: Message[];
  tasks: Task[];
  nameOf: (m: Message) => string | null;
  /** Keep Gmail in step (Inbox Settings): read state, and Done as archive. */
  gmailSync: { read: boolean; archive: boolean };
  pushToast: (text: string, action?: { label: string; run: () => void }) => void;
};

const rowToState = (r: any): InboxState => ({ threadKey: r.thread_key, readAt: r.read_at, snoozedUntil: r.snoozed_until, doneAt: r.done_at, trashedAt: r.trashed_at, starredAt: r.starred_at, updatedAt: r.updated_at });

export function useInbox({ meMemberId, isAdmin, liveMessages, tasks, nameOf, gmailSync, pushToast }: UseInboxDeps) {
  const [loaded, setLoaded] = useState<Message[]>([]);
  const [convs, setConvs] = useState<Map<string, GhlConv>>(new Map());
  const [states, setStates] = useState<Map<string, InboxState>>(new Map());
  const [blocks, setBlocks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const myTaskIds = useMemo(() => new Set(tasks.filter((t) => t.assigneeId === meMemberId).map((t) => t.id)), [tasks, meMemberId]);

  type Loaded = Awaited<ReturnType<typeof fetchInbox>>;
  const apply = useCallback((r: Loaded) => {
    setLoaded(r.messages); setConvs(r.convs); setStates(r.states); setBlocks(r.blocks); setError(null); setLoading(false);
  }, []);
  const fail = useCallback((e: any) => { setError(e?.message ?? "The Inbox could not load."); setLoading(false); }, []);
  const load = useCallback(() => fetchInbox(meMemberId, myTaskIds).then(apply, fail), [meMemberId, myTaskIds, apply, fail]);

  useEffect(() => {
    let live = true;
    fetchInbox(meMemberId, myTaskIds).then((r) => { if (live) apply(r); }, (e) => { if (live) fail(e); });
    return () => { live = false; };
  }, [meMemberId, myTaskIds, apply, fail]);
  // A new GoHighLevel conversation is only known after the next read, and a
  // snooze ends with the clock: both are picked up every two minutes.
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); load(); }, 120_000);
    return () => clearInterval(id);
  }, [load]);

  // Live messages that belong here.
  const live = useMemo(() => liveMessages.filter((m) =>
    m.mailboxMemberId === meMemberId
    || (m.ghlConversationId && convs.has(m.ghlConversationId))
    || (m.channel === "chat" && m.taskId && myTaskIds.has(m.taskId))), [liveMessages, meMemberId, convs, myTaskIds]);

  const threads: InboxThread[] = useMemo(() => {
    const byId = new Map<string, Message>();
    for (const m of loaded) byId.set(m.id, m);
    for (const m of live) byId.set(m.id, m);
    // Blocked senders stay out, except what is already in the Trash.
    return buildThreads([...byId.values()], states, { now, nameOf, convs })
      .filter((t) => t.trashed || !isBlocked(t.peerAddress, blocks));
  }, [loaded, live, states, now, nameOf, convs, blocks]);

  // ── Your own state on a conversation ────────────────────────────────────
  const statesRef = useRef(states);
  useEffect(() => { statesRef.current = states; }, [states]);
  const writeState = useCallback(async (keys: string[], patch: Partial<Pick<InboxState, "readAt" | "snoozedUntil" | "doneAt" | "trashedAt" | "starredAt">>) => {
    const at = new Date().toISOString();
    const before = keys.map((k) => statesRef.current.get(k) ?? null);
    setStates((s) => {
      const n = new Map(s);
      for (const k of keys) n.set(k, { ...(s.get(k) ?? { threadKey: k, readAt: null, snoozedUntil: null, doneAt: null, updatedAt: null }), ...patch, updatedAt: at });
      return n;
    });
    const rows = keys.map((k) => {
      const cur = { ...(statesRef.current.get(k) ?? {}), ...patch } as Partial<InboxState>;
      return { member_id: meMemberId, thread_key: k, read_at: cur.readAt ?? null, snoozed_until: cur.snoozedUntil ?? null, done_at: cur.doneAt ?? null, ...(cur.trashedAt !== undefined ? { trashed_at: cur.trashedAt } : {}), ...(cur.starredAt !== undefined ? { starred_at: cur.starredAt } : {}), updated_at: at };
    });
    const { error: e } = await supabase.from("inbox_state").upsert(rows, { onConflict: "member_id,thread_key" });
    if (e) pushToast(`Couldn't save that: ${e.message}`);
    // Undo puts back exactly what was there.
    return async () => {
      setStates((s) => {
        const n = new Map(s);
        keys.forEach((k, i) => { const b = before[i]; if (b) n.set(k, b); else n.delete(k); });
        return n;
      });
      await supabase.from("inbox_state").upsert(keys.map((k, i) => {
        const b = before[i];
        return { member_id: meMemberId, thread_key: k, read_at: b?.readAt ?? null, snoozed_until: b?.snoozedUntil ?? null, done_at: b?.doneAt ?? null, ...(b?.trashedAt !== undefined ? { trashed_at: b?.trashedAt ?? null } : {}), ...(b?.starredAt !== undefined ? { starred_at: b?.starredAt ?? null } : {}), updated_at: new Date().toISOString() };
      }), { onConflict: "member_id,thread_key" });
    };
  }, [meMemberId, pushToast]);

  // The same change in Gmail, for emails, when the person has it switched on.
  // Fire and forget: the Inbox never waits on Gmail.
  const toGmail = useCallback((keys: string[], change: "read" | "unread" | "archive" | "unarchive" | "star" | "unstar") => {
    const gm = keys.filter((k) => k.startsWith("gm:"));
    if (!gm.length) return;
    authedFetch("/api/inbox/gmail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadKeys: gm, change }) }).catch(() => null);
  }, []);
  const withGmail = useCallback(async (keys: string[], undo: () => Promise<void>, change: "read" | "unread" | "archive" | null, reverse: "read" | "unread" | "unarchive" | null) => {
    if (change) toGmail(keys, change);
    return async () => { await undo(); if (reverse) toGmail(keys, reverse); };
  }, [toGmail]);
  const markRead = useCallback(async (keys: string[]) => withGmail(keys, await writeState(keys, { readAt: new Date().toISOString() }), gmailSync.read ? "read" : null, gmailSync.read ? "unread" : null), [writeState, withGmail, gmailSync.read]);
  const markUnread = useCallback(async (keys: string[]) => withGmail(keys, await writeState(keys, { readAt: null }), gmailSync.read ? "unread" : null, gmailSync.read ? "read" : null), [writeState, withGmail, gmailSync.read]);
  const markDone = useCallback(async (keys: string[]) => {
    const at = new Date().toISOString();
    const undo = await writeState(keys, { doneAt: at, readAt: at, snoozedUntil: null });
    // Done archives (which also marks read); with only read on, it marks read.
    return withGmail(keys, undo, gmailSync.archive ? "archive" : gmailSync.read ? "read" : null, gmailSync.archive ? "unarchive" : null);
  }, [writeState, withGmail, gmailSync.archive, gmailSync.read]);
  // Star, here and on the email in Gmail.
  const star = useCallback(async (keys: string[], on: boolean) => {
    const undo = await writeState(keys, { starredAt: on ? new Date().toISOString() : null });
    toGmail(keys, on ? "star" : "unstar");
    return async () => { await undo(); toGmail(keys, on ? "unstar" : "star"); };
  }, [writeState, toGmail]);
  // Delete: the Inbox's Trash, and Gmail's for an email (30 days there).
  const trash = useCallback(async (keys: string[], restore = false) => {
    const at = new Date().toISOString();
    const undoState = await writeState(keys, restore ? { trashedAt: null } : { trashedAt: at, readAt: at, snoozedUntil: null });
    const results = await Promise.all(keys.map((k) => authedFetch("/api/inbox/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadKey: k, restore }) })
      .then((r) => r.json()).catch(() => ({ gmail: false }))));
    const gmailNote = results.find((r: any) => r?.note && keys.some((k) => k.startsWith("gm:")))?.note as string | undefined;
    return { undo: async () => { await undoState(); await Promise.all(keys.map((k) => authedFetch("/api/inbox/trash", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadKey: k, restore: !restore }) }).catch(() => null))); }, gmailNote };
  }, [writeState]);
  // Block sender: an address, a phone or "@domain". Their conversations go to
  // the Trash and nothing more from them shows here.
  const block = useCallback(async (address: string) => {
    const a = address.trim().toLowerCase();
    if (!a) return;
    const { error: e } = await supabase.from("inbox_blocks").upsert({ member_id: meMemberId, address: a }, { onConflict: "member_id,address" });
    if (e) throw new Error(e.message);
    setBlocks((b) => (b.includes(a) ? b : [...b, a]));
  }, [meMemberId]);
  const unblock = useCallback(async (address: string) => {
    await supabase.from("inbox_blocks").delete().eq("member_id", meMemberId).eq("address", address);
    setBlocks((b) => b.filter((x) => x !== address));
  }, [meMemberId]);
  const snooze = useCallback((keys: string[], until: Date) => writeState(keys, { snoozedUntil: until.toISOString(), doneAt: null }), [writeState]);

  // ── Server actions ──────────────────────────────────────────────────────
  const post = useCallback(async (url: string, body: object) => {
    const res = await authedFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? "That didn't work.");
    return j;
  }, []);
  const linkTask = useCallback(async (threadKey: string, taskId: string | null) => {
    await post("/api/inbox/link", { threadKey, taskId });
    setLoaded((ms) => ms.map((m) => (thKey(m) === threadKey ? { ...m, taskId } : m)));
  }, [post]);
  const assign = useCallback(async (threadKey: string, memberId: string | null) => {
    await post("/api/inbox/assign", { threadKey, memberId });
    if (memberId !== meMemberId && memberId) {
      setConvs((c) => { const n = new Map(c); n.delete(threadKey.slice(4)); return n; });
    }
  }, [post, meMemberId]);
  const send = useCallback(async (body: { threadKey?: string | null; to?: string; cc?: string[]; bcc?: string[]; subject?: string; body: string; attachments?: { path: string; name: string }[] }) => {
    const j = await post("/api/inbox/send", body);
    load();
    return j as { messageId: string; threadKey: string };
  }, [post, load]);
  const improve = useCallback(async (text: string, channel: string) => (await post("/api/ai/improve", { text, channel })) as { text: string; changed: boolean }, [post]);

  return { threads, loading, error, reload: load, isAdmin, convs, blocks, block, unblock, markRead, markUnread, markDone, trash, star, snooze, linkTask, assign, send, improve };
}

async function fetchInbox(meMemberId: string, myTaskIds: Set<string>) {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  // Admins can read every conversation, so whose it is gets decided here.
  const { data: convRows, error: cErr } = await supabase.from("ghl_conversations")
    .select("id, assigned_member_id, contact_name, phone, email, location_id").gte("last_message_at", since).limit(3000);
  if (cErr) throw cErr;
  const mine = (convRows ?? []).filter((c: any) => !c.assigned_member_id || c.assigned_member_id === meMemberId);
  const convs = new Map<string, GhlConv>(mine.map((c: any) => [c.id, { id: c.id, assignedMemberId: c.assigned_member_id, contactName: c.contact_name, phone: c.phone, email: c.email, locationId: c.location_id }]));

  const reads: PromiseLike<any>[] = [
    supabase.from("messages").select("*").eq("mailbox_member_id", meMemberId).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
  ];
  const ids = [...convs.keys()];
  for (let i = 0; i < ids.length; i += CHUNK) reads.push(supabase.from("messages").select("*").in("ghl_conversation_id", ids.slice(i, i + CHUNK)).gte("created_at", since).limit(2000));
  const taskIds = [...myTaskIds];
  for (let i = 0; i < taskIds.length; i += CHUNK) reads.push(supabase.from("messages").select("*").eq("channel", "chat").in("task_id", taskIds.slice(i, i + CHUNK)).gte("created_at", since).limit(1000));
  reads.push(supabase.from("inbox_state").select("*").eq("member_id", meMemberId));
  // Read on its own: a missing table (before inbox-blocks.sql) just means none.
  const blockRes = await supabase.from("inbox_blocks").select("address").eq("member_id", meMemberId);

  const results = await Promise.all(reads);
  const stateRes = results.pop();
  const firstErr = results.find((r) => r.error)?.error ?? stateRes.error;
  if (firstErr) throw firstErr;
  return {
    messages: results.flatMap((r) => (r.data ?? []).map(rowToMessage)) as Message[],
    convs,
    states: new Map<string, InboxState>((stateRes.data ?? []).map((r: any) => [r.thread_key, rowToState(r)])),
    blocks: ((blockRes.data ?? []) as any[]).map((r) => r.address as string),
  };
}
