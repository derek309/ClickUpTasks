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
import { buildThreads, mergeById, mergeStates, type GhlConv, type InboxState, type InboxThread } from "./inboxModel";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DAYS = 30;
const CHUNK = 150;

export type UseInboxDeps = {
  meMemberId: string;
  isAdmin: boolean;
  /** The app's live messages (realtime inserts land here first). */
  liveMessages: Message[];
  /** Task chat notes made from your notifications (mentions, comments, client
   *  reviews), shown as messages on the task's chat conversation. */
  extraMessages?: Message[];
  tasks: Task[];
  nameOf: (m: Message) => string | null;
  /** Keep Gmail in step (Inbox Settings): read state, and Done as archive. */
  gmailSync: { read: boolean; archive: boolean };
  pushToast: (text: string, action?: { label: string; run: () => void }) => void;
};

const rowToState = (r: any): InboxState => ({ threadKey: r.thread_key, readAt: r.read_at, snoozedUntil: r.snoozed_until, doneAt: r.done_at, trashedAt: r.trashed_at, starredAt: r.starred_at, updatedAt: r.updated_at });

export function useInbox({ meMemberId, isAdmin, liveMessages, extraMessages, tasks, nameOf, gmailSync, pushToast }: UseInboxDeps) {
  const [loaded, setLoaded] = useState<Message[]>([]);
  const [convs, setConvs] = useState<Map<string, GhlConv>>(new Map());
  const [states, setStates] = useState<Map<string, InboxState>>(new Map());
  const [blocks, setBlocks] = useState<string[]>([]);
  // Older than 30 days, brought in by a search.
  const [older, setOlder] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // GoHighLevel conversations you assigned to a teammate: out of your list at once.
  const [handedOff, setHandedOff] = useState<Set<string>>(new Set());

  // Your task ids as one string, so a change to any task (a title, a due
  // date, a teammate's edit) does not read the whole Inbox again: only a
  // task becoming or leaving yours does.
  const myTaskKey = useMemo(() => tasks.filter((t) => t.assigneeId === meMemberId).map((t) => t.id).sort().join(","), [tasks, meMemberId]);
  const myTaskIds = useMemo(() => new Set(myTaskKey ? myTaskKey.split(",") : []), [myTaskKey]);

  // When each conversation's state was last changed here: a read that began
  // before that change must not put the old state back.
  const touchedRef = useRef(new Map<string, number>());
  // When the last read began; the two minute refresh asks only for what
  // changed since then.
  const lastReadRef = useRef<number | null>(null);
  type Loaded = Awaited<ReturnType<typeof fetchInbox>>;
  const apply = useCallback((r: Loaded) => {
    if (r.partial) setLoaded((prev) => mergeById(prev, r.messages));
    else setLoaded(r.messages);
    setConvs(r.convs);
    setStates((cur) => mergeStates(cur, r.states, touchedRef.current, r.startedAt));
    setBlocks(r.blocks); setError(null); setLoading(false);
    lastReadRef.current = r.startedAt;
  }, []);
  const fail = useCallback((e: any) => { setError(e?.message ?? "The Inbox could not load."); setLoading(false); }, []);
  const load = useCallback(() => fetchInbox(meMemberId, myTaskIds).then(apply, fail), [meMemberId, myTaskIds, apply, fail]);

  useEffect(() => {
    let live = true;
    fetchInbox(meMemberId, myTaskIds).then((r) => { if (live) apply(r); }, (e) => { if (live) fail(e); });
    return () => { live = false; };
  }, [meMemberId, myTaskIds, apply, fail]);
  // A new GoHighLevel conversation is only known after the next read, and a
  // snooze ends with the clock: both are picked up every two minutes. Each
  // refresh reads only messages changed since the last read (a minute of
  // overlap); every tenth is a full read, which also catches a conversation
  // that became yours.
  const ticks = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      const full = ++ticks.current % 10 === 0 || lastReadRef.current === null;
      const since = full ? undefined : new Date(lastReadRef.current! - 60_000).toISOString();
      fetchInbox(meMemberId, myTaskIds, since).then(apply, fail);
    }, 120_000);
    return () => clearInterval(id);
  }, [meMemberId, myTaskIds, apply, fail]);

  // Live messages that belong here.
  const live = useMemo(() => liveMessages.filter((m) =>
    m.mailboxMemberId === meMemberId
    || (m.ghlConversationId && convs.has(m.ghlConversationId))
    || (m.channel === "chat" && m.taskId && myTaskIds.has(m.taskId))), [liveMessages, meMemberId, convs, myTaskIds]);

  const threads: InboxThread[] = useMemo(() => {
    const byId = new Map<string, Message>();
    for (const m of loaded) byId.set(m.id, m);
    for (const m of live) byId.set(m.id, m);
    for (const m of extraMessages ?? []) byId.set(m.id, m);
    for (const m of older) if (!byId.has(m.id)) byId.set(m.id, m);
    // Blocked senders stay out, except what is already in the Trash, and so
    // does a conversation you just handed to someone else.
    return buildThreads([...byId.values()], states, { now, nameOf, convs })
      .filter((t) => (t.trashed || !isBlocked(t.peerAddress, blocks)) && !(t.ghlConversationId && handedOff.has(t.ghlConversationId)));
  }, [loaded, live, extraMessages, older, states, now, nameOf, convs, blocks, handedOff]);

  // ── Your own state on a conversation ────────────────────────────────────
  const statesRef = useRef(states);
  useEffect(() => { statesRef.current = states; }, [states]);
  const writeState = useCallback(async (keys: string[], patch: Partial<Pick<InboxState, "readAt" | "snoozedUntil" | "doneAt" | "trashedAt" | "starredAt">>) => {
    const at = new Date().toISOString();
    const before = keys.map((k) => statesRef.current.get(k) ?? null);
    // The ref moves now, not after the next render, so a second action right
    // behind this one builds on it instead of writing the old state back.
    const next = new Map(statesRef.current);
    for (const k of keys) {
      next.set(k, { ...(next.get(k) ?? { threadKey: k, readAt: null, snoozedUntil: null, doneAt: null, updatedAt: null }), ...patch, updatedAt: at });
      touchedRef.current.set(k, Date.now());
    }
    statesRef.current = next;
    setStates(next);
    const rows = keys.map((k) => {
      const cur = next.get(k)!;
      return { member_id: meMemberId, thread_key: k, read_at: cur.readAt ?? null, snoozed_until: cur.snoozedUntil ?? null, done_at: cur.doneAt ?? null, ...(cur.trashedAt !== undefined ? { trashed_at: cur.trashedAt } : {}), ...(cur.starredAt !== undefined ? { starred_at: cur.starredAt } : {}), updated_at: at };
    });
    const { error: e } = await supabase.from("inbox_state").upsert(rows, { onConflict: "member_id,thread_key" });
    if (e) pushToast(`Couldn't save that: ${e.message}`);
    // Undo puts back exactly what was there.
    return async () => {
      const n = new Map(statesRef.current);
      keys.forEach((k, i) => { const b = before[i]; if (b) n.set(k, b); else n.delete(k); touchedRef.current.set(k, Date.now()); });
      statesRef.current = n;
      setStates(n);
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
      const id = threadKey.slice(4);
      setConvs((c) => { const n = new Map(c); n.delete(id); return n; });
      setHandedOff((h) => new Set(h).add(id));
    }
  }, [post, meMemberId]);
  // Search past the 30 days loaded: what it finds joins the list.
  const searchOlder = useCallback(async (q: string) => {
    if (q.trim().length < 3) return 0;
    const res = await authedFetch(`/api/inbox/search?q=${encodeURIComponent(q.trim())}`).catch(() => null);
    if (!res?.ok) return 0;
    const rows = ((await res.json())?.messages ?? []).map(rowToMessage) as Message[];
    setOlder((o) => { const ids = new Set(o.map((m) => m.id)); return [...o, ...rows.filter((m) => !ids.has(m.id))]; });
    return rows.length;
  }, []);
  const addContact = useCallback(async (threadKey: string, to: { clientId?: string; newClientName?: string }) => {
    const j = await post("/api/inbox/contact", { threadKey, ...to });
    load();
    return j as { clientId: string; contactId: string };
  }, [post, load]);
  const send = useCallback(async (body: { threadKey?: string | null; channel?: "sms"; contactId?: string; to?: string; cc?: string[]; bcc?: string[]; subject?: string; body: string; attachments?: { path: string; name: string }[] }) => {
    const j = await post("/api/inbox/send", body);
    load();
    return j as { messageId: string; threadKey: string | null };
  }, [post, load]);
  const improve = useCallback(async (text: string, channel: string) => (await post("/api/ai/improve", { text, channel })) as { text: string; changed: boolean }, [post]);

  return { threads, loading, error, reload: load, isAdmin, convs, blocks, block, unblock, markRead, markUnread, markDone, trash, star, snooze, addContact, searchOlder, linkTask, assign, send, improve };
}

async function fetchInbox(meMemberId: string, myTaskIds: Set<string>, changedSince?: string) {
  const startedAt = Date.now();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  // Admins can read every conversation, so whose it is gets decided here.
  const { data: convRows, error: cErr } = await supabase.from("ghl_conversations")
    .select("id, assigned_member_id, contact_name, phone, email, location_id").gte("last_message_at", since).limit(3000);
  if (cErr) throw cErr;
  const mine = (convRows ?? []).filter((c: any) => !c.assigned_member_id || c.assigned_member_id === meMemberId);
  const convs = new Map<string, GhlConv>(mine.map((c: any) => [c.id, { id: c.id, assignedMemberId: c.assigned_member_id, contactName: c.contact_name, phone: c.phone, email: c.email, locationId: c.location_id }]));

  // A refresh asks only for rows changed since the last read.
  const changed = (q: any) => (changedSince ? q.gte("updated_at", changedSince) : q);
  const reads: Promise<{ data: any[]; error: any }>[] = [
    // Your mail, every page of it: the database hands back 1,000 rows at most.
    allPages((from, to) => changed(supabase.from("messages").select("*").eq("mailbox_member_id", meMemberId).gte("created_at", since)).order("created_at", { ascending: false }).range(from, to)),
  ];
  const ids = [...convs.keys()];
  for (let i = 0; i < ids.length; i += CHUNK) reads.push(allPages((from, to) => changed(supabase.from("messages").select("*").in("ghl_conversation_id", ids.slice(i, i + CHUNK)).gte("created_at", since)).order("created_at", { ascending: false }).range(from, to)));
  const taskIds = [...myTaskIds];
  for (let i = 0; i < taskIds.length; i += CHUNK) reads.push(allPages((from, to) => changed(supabase.from("messages").select("*").eq("channel", "chat").in("task_id", taskIds.slice(i, i + CHUNK)).gte("created_at", since)).order("created_at", { ascending: false }).range(from, to)));
  const stateRes = await supabase.from("inbox_state").select("*").eq("member_id", meMemberId);
  // Read on its own: a missing table (before inbox-blocks.sql) just means none.
  const blockRes = await supabase.from("inbox_blocks").select("address").eq("member_id", meMemberId);

  const results = await Promise.all(reads);
  const firstErr = results.find((r) => r.error)?.error ?? stateRes.error;
  if (firstErr) throw firstErr;
  return {
    messages: results.flatMap((r) => (r.data ?? []).map(rowToMessage)) as Message[],
    partial: !!changedSince,
    startedAt,
    convs,
    states: new Map<string, InboxState>((stateRes.data ?? []).map((r: any) => [r.thread_key, rowToState(r)])),
    blocks: ((blockRes.data ?? []) as any[]).map((r) => r.address as string),
  };
}

const PAGE = 1000;
/** Every page of a query, 1,000 rows at a time (up to 10,000). */
async function allPages(page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<{ data: any[]; error: any }> {
  const out: any[] = [];
  for (let from = 0; from < 10 * PAGE; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return { data: out, error: null };
}
