"use client";

// Live updates from teammates, clients and the server, and the catch up when
// the tab comes back into view. Lifted out of Cockpit.tsx unchanged (audit
// 2026-09-29, 3.4); it writes Cockpit's own lists, so it is handed their setters.
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { supabaseReady } from "@/lib/supabase";
import { subscribeRealtime } from "@/lib/realtime";
import { fetchAll, trashedSince, rowToTask, rowToClient, rowToNotif, rowToMessage, rowToClientNote, rowToDmMessage, type SyncMarks } from "@/lib/db";
import { WRITE_SETTLE_MS, mergeFetched, tasksWrittenSince } from "@/lib/localTaskWrites";
import { TODAY, todayIso, type Client, type ClientLink, type ClientNote, type Contact, type DmMessage, type Folder, type Message, type Notification, type Project, type Stage, type Task, type VaultFolder } from "@/lib/data";

type Set<T> = Dispatch<SetStateAction<T[]>>;

export function useLiveSync({
  loading, meId, syncMarks, pushToast, isOwnClientEcho,
  setTasks, setClients, setProjects, setContacts, setNotifications, setMessages, setClientNotes,
  setClientLinks, setVaultFolders, setFolders, setStages, setDmMessages, setActiveClient, setOpenTaskId,
}: {
  /** True until the first load lands; nothing subscribes before it. */
  loading: boolean;
  meId: string;
  syncMarks: RefObject<SyncMarks>;
  pushToast: (text: string) => void;
  /** This tab's own client write coming back over the live channel (Cockpit's short ledger). */
  isOwnClientEcho: (id: string) => boolean;
  setTasks: Set<Task>; setClients: Set<Client>; setProjects: Set<Project>; setContacts: Set<Contact>;
  setNotifications: Set<Notification>; setMessages: Set<Message>; setClientNotes: Set<ClientNote>;
  setClientLinks: Set<ClientLink>; setVaultFolders: Set<VaultFolder>; setFolders: Set<Folder>; setStages: Set<Stage>;
  setDmMessages: Set<DmMessage>;
  setActiveClient: Dispatch<SetStateAction<string>>;
  setOpenTaskId: Dispatch<SetStateAction<string | null>>;
}) {
  // Live sync — tasks/clients/notifications only (see supabase/realtime.sql
  // + the plan doc for why not all 7 tables). Gated on !loading so the
  // channel isn't stood up before the initial fetchAll() populates state.
  // Every handler uses raw setXxx — never update()/patchTask()/addComment()/
  // notify() — so an incoming teammate's change never re-derives a diff
  // against local state and never double-fires GHL sync or notifications.
  useEffect(() => {
    if (loading || !supabaseReady) return;
    const unsub = subscribeRealtime({
      onTask: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setTasks((ts) => ts.filter((t) => t.id !== id));
          return;
        }
        const row = p.new;
        // Moving a task to the Trash is an UPDATE, not a DELETE, so without
        // this it stayed on everyone else's screen until they reloaded.
        if (row.deleted_at) { setTasks((ts) => ts.filter((t) => t.id !== row.id)); return; }
        // Every server-side write (client portal response, inbound email/SMS,
        // owner-side completion) must send updated_by: null. Without it
        // this stays pinned to whichever rep last touched the row from the
        // browser, so a real client reply gets silently dropped by this check
        // as if it were an echo of that rep's own edit — and their next save
        // then overwrites the reply that was never applied locally.
        if (row.updated_by && row.updated_by === meId) return; // server-confirmed own write
        const t = rowToTask(row);
        setTasks((ts) => (ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]));
      },
      onClient: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          // Cascade purge for teammates who only got the `clients` DELETE
          // event — contacts/projects/client_links aren't in the publication,
          // so no CDC event arrives for them independently. client_notes IS
          // published now, so its own cascade-delete rows emit their own CDC
          // events too (Postgres FK cascades are per-row under the hood) —
          // this purge is a harmless, redundant backstop for it, not load-bearing.
          setClients((cs) => cs.filter((c) => c.id !== id));
          setProjects((ps) => ps.filter((p2) => p2.clientId !== id));
          setTasks((ts) => ts.filter((t) => t.clientId !== id));
          setClientLinks((ls) => ls.filter((l) => l.clientId !== id));
          setClientNotes((ns) => ns.filter((n) => n.clientId !== id));
          setActiveClient((a) => (a === id ? "all" : a));
          return;
        }
        const row = p.new;
        // A client moved to the Trash, likewise. Its projects are not in the
        // realtime publication, so they go with it here; its tasks arrive as
        // their own trashed rows above.
        if (row.deleted_at) {
          setClients((cs) => cs.filter((c) => c.id !== row.id));
          setProjects((ps) => ps.filter((p2) => p2.clientId !== row.id));
          setActiveClient((a) => (a === row.id ? "all" : a));
          return;
        }
        if (isOwnClientEcho(row.id as string)) return;
        const c = rowToClient(row);
        setClients((cs) => (cs.some((x) => x.id === c.id) ? cs.map((x) => (x.id === c.id ? c : x)) : [...cs, c]));
      },
      onNotification: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setNotifications((ns) => ns.filter((n) => n.id !== id));
          return;
        }
        const n = rowToNotif(p.new);
        setNotifications((ns) => (ns.some((x) => x.id === n.id) ? ns.map((x) => (x.id === n.id ? n : x)) : [n, ...ns]));
      },
      // No echo suppression needed: an own-write (send, admin edit, or
      // delete) just re-writes/removes the same array slot via the id-based
      // dedup below, same effect as a remote change landing here.
      onMessage: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setMessages((ms) => ms.filter((m) => m.id !== id));
          return;
        }
        const m = rowToMessage(p.new);
        setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms.map((x) => (x.id === m.id ? m : x)) : [...ms, m]));
      },
      // Same reasoning as messages: a note is only ever fully rewritten on an
      // explicit Save click (not keystroke-driven like a task title), so
      // id-based dedup is enough — no updated_by/echo-suppression column needed.
      onClientNote: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setClientNotes((ns) => ns.filter((n) => n.id !== id));
          return;
        }
        const n = rowToClientNote(p.new);
        setClientNotes((ns) => (ns.some((x) => x.id === n.id) ? ns.map((x) => (x.id === n.id ? n : x)) : [n, ...ns]));
      },
      // Same reasoning as messages/client_notes: append-only, so id dedup covers it.
      onDmMessage: (p) => {
        if (p.eventType === "DELETE") {
          const id = (p.old as { id: string }).id;
          setDmMessages((ms) => ms.filter((m) => m.id !== id));
          return;
        }
        const m = rowToDmMessage(p.new);
        setDmMessages((ms) => (ms.some((x) => x.id === m.id) ? ms.map((x) => (x.id === m.id ? m : x)) : [...ms, m]));
      },
      onStatusChange: (s) => { if (s === "CHANNEL_ERROR") pushToast("⚠️ Live updates interrupted — reconnecting…"); },
    });
    return unsub;
    // One subscription per sign in. The handlers only call state setters,
    // which never change, and two helpers Cockpit rebuilds each render;
    // listing those would tear the channel down and stand it up on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, meId]);

  // Fallback for the 2 tables without a live subscription (contacts/projects/
  // client_links), and a reconnection safety net for the 5 that do —
  // postgres_changes has no replay/resume, and browsers commonly suspend
  // backgrounded WebSocket connections, so a dropped socket means silently
  // missed events, not queued ones. Reuses fetchAll() for the data.
  //
  // tasks/clients/notifications/messages/client_notes are merged (add/update
  // by id), NEVER wholesale-replaced: their deletions are already fully
  // covered by the live realtime DELETE handlers above, so this fallback has
  // no need to remove anything for them — and a wholesale replace here was
  // actively dangerous: any transient gap between this fetch's snapshot and a
  // very recent local write could wipe a real, just-saved task (or chat
  // message) out of view even though it was safely in the database.
  // contacts/projects/client_links have no realtime coverage at all, so they
  // still need a full replace (including removals) to reflect deletes.
  //
  // Merging alone left one hole: a task or client someone else trashed while
  // this tab's socket was down never left the screen, and could still be
  // edited, writing to a row on its way to the purge. So the refetch also asks
  // which rows were trashed since it last looked and drops exactly those —
  // positive evidence, rather than treating "absent from the fetch" as deleted,
  // which is what made a wholesale replace dangerous in the first place.
  useEffect(() => {
    let lastRefetch = 0;
    let trashedSinceIso = new Date().toISOString();
    const refetch = async () => {
      if (document.visibilityState !== "visible") return;
      // TODAY (and every due bucket, "Mark reviewed" stamp and Today pick built
      // from it) is fixed when the page loads. A window left open overnight
      // kept treating yesterday as today, so coming back on a new day reloads.
      if (todayIso() !== TODAY) { window.location.reload(); return; }
      // Two minutes, not twenty seconds: live updates keep the tab current in
      // between, and every return re-read all 4,200 contacts, which ran the
      // database out of disk reads (Derek, 2026-10-07, Supabase Disk IO warning).
      if (Date.now() - lastRefetch < 120_000) return;
      lastRefetch = Date.now();
      const askedAt = new Date().toISOString();
      // A task this tab saved from just before the fetch onward keeps its
      // on screen copy; the fetch may have read it before the save landed
      // (lib/localTaskWrites).
      const writesSince = Date.now() - WRITE_SETTLE_MS;
      try {
        const d = await fetchAll(syncMarks.current);
        syncMarks.current = d.marks;
        setContacts(d.contacts); setClientLinks(d.clientLinks); setProjects(d.projects);
        setTasks((prev) => mergeFetched(prev, d.tasks, tasksWrittenSince(writesSince)));
        setClients((prev) => mergeFetched(prev, d.clients));
        setNotifications((prev) => mergeFetched(prev, d.notifications));
        setMessages((prev) => mergeFetched(prev, d.messages));
        setClientNotes((prev) => mergeFetched(prev, d.clientNotes));
        setVaultFolders((prev) => mergeFetched(prev, d.vaultFolders));
        setFolders((prev) => mergeFetched(prev, d.folders));
        setStages((prev) => mergeFetched(prev, d.stages));
        setDmMessages((prev) => mergeFetched(prev, d.dmMessages));

        const [goneTasks, goneClients] = await Promise.all([
          trashedSince("tasks", trashedSinceIso),
          trashedSince("clients", trashedSinceIso),
        ]);
        trashedSinceIso = askedAt;
        if (goneTasks.length) {
          const gone = new Set(goneTasks);
          setTasks((prev) => prev.filter((t) => !gone.has(t.id)));
          // Whatever is open went with it — leaving the drawer up over a
          // trashed task invites an edit that writes to a row nobody will see.
          setOpenTaskId((id) => (id && gone.has(id) ? null : id));
        }
        if (goneClients.length) {
          const gone = new Set(goneClients);
          setClients((prev) => prev.filter((c) => !gone.has(c.id)));
        }
      } catch (e) { console.warn("[realtime] visibility refetch failed", e); }
    };
    document.addEventListener("visibilitychange", refetch);
    window.addEventListener("focus", refetch);
    return () => { document.removeEventListener("visibilitychange", refetch); window.removeEventListener("focus", refetch); };
    // Listeners set up once; everything they call is a state setter or a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
