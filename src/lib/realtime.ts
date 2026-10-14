// Supabase Realtime wiring — pure channel setup/teardown, no app state here.
// Cockpit.tsx owns all React state and decides how to merge incoming rows.
// Subscribes to tasks/clients/notifications (see supabase/realtime.sql and
// the plan doc for why those three and not all 7 domain tables), messages
// (supabase/messages.sql — an inbound GHL reply appears in an open thread
// without a manual reload), client_notes (supabase/realtime-client-
// notes.sql — the Chat tab, so a teammate's message shows up live), and
// and dm_messages (supabase/dm-chat.sql — same reasoning, for private 1:1 DMs).
//
// All 7 tables share ONE channel (one `.on()` binding each, one `.subscribe()`
// call) instead of 7 independent channels — each subscribed channel counts as
// its own connection against Supabase's Realtime quota, and every open tab
// was paying that 7x multiplier continuously (join + periodic heartbeat per
// channel) for as long as it stayed open. Found after "Peak Concurrent
// Connections" and "Realtime Messages" both blew well past the free-tier
// quota with only 4 monthly active users (Derek, Aug 3). One channel error
// now affects all 7 tables' live updates together, not just one — an
// acceptable tradeoff since they're the same underlying connection either way.
import { supabase } from "./supabase";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export type Payload = RealtimePostgresChangesPayload<Record<string, unknown>>;

/** A list's new place, sent to the other open tabs when an admin rearranges a client's tabs. */
export type ListPlace = { id: string; position: number };

// The channel that is up right now, so a rearrange can be told to everyone on it.
let live: ReturnType<typeof supabase.channel> | null = null;

/** Tell every other open tab a client's lists were rearranged (Derek, 2026-10-14).
 *  projects is not in the realtime publication, and adding a table that is not
 *  there to this one channel would break live updates for all of them, so the
 *  new places go out as a broadcast on the same channel (no extra connection,
 *  nothing to run in the database). The save itself is the projects upsert. */
export function broadcastListOrder(places: ListPlace[]) {
  if (!live || !places.length) return;
  void live.send({ type: "broadcast", event: "list-order", payload: { places } }).catch(() => {});
}

export function subscribeRealtime(handlers: {
  onTask: (p: Payload) => void;
  onClient: (p: Payload) => void;
  onNotification: (p: Payload) => void;
  onMessage: (p: Payload) => void;
  onClientNote: (p: Payload) => void;
  onDmMessage: (p: Payload) => void;
  onListOrder?: (places: ListPlace[]) => void;
  onStatusChange?: (status: string) => void;
}, opts: { meId?: string; dm?: boolean } = {}): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let torn = false;

  const connect = () => {
    channel = supabase
      .channel("rt:app")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, handlers.onTask)
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, handlers.onClient)
      // Only your own notifications: the app shows nobody else's, and an
      // admin's tab was sent the whole team's (loading plan step 5).
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", ...(opts.meId ? { filter: `recipient_id=eq.${opts.meId}` } : {}) }, handlers.onNotification)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, handlers.onMessage)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_notes" }, handlers.onClientNote);
    // Direct messages only while they're switched on (app_settings).
    if (opts.dm !== false) channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "dm_messages" }, handlers.onDmMessage);
    // A rearranged client's tabs, from another tab (broadcastListOrder).
    channel = channel.on("broadcast", { event: "list-order" }, (msg) => {
      const places = (msg.payload as { places?: unknown })?.places;
      if (Array.isArray(places)) handlers.onListOrder?.(places.filter((x): x is ListPlace => !!x && typeof x.id === "string" && typeof x.position === "number"));
    });
    channel = channel
      .subscribe((status) => {
        handlers.onStatusChange?.(status);
        if (status === "SUBSCRIBED") { retries = 0; live = channel; }
        if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !torn) {
          // One reconnect in flight at a time. A flapping connection can
          // report the error several times over, and each report used to
          // schedule its own reconnect on top of the last — several channels
          // on the same topic, every live change handled once per channel.
          if (retryTimer) clearTimeout(retryTimer);
          retries += 1;
          const delay = Math.min(1000 * 2 ** retries, 15000);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (live === channel) live = null;
            if (channel) supabase.removeChannel(channel);
            connect();
          }, delay);
        }
      });
  };
  connect();

  return () => {
    torn = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (live === channel) live = null;
    if (channel) supabase.removeChannel(channel);
  };
}
