// Supabase Realtime wiring — pure channel setup/teardown, no app state here.
// Cockpit.tsx owns all React state and decides how to merge incoming rows.
// Subscribes to tasks/clients/notifications (see supabase/realtime.sql and
// the plan doc for why those three and not all 7 domain tables), messages
// (supabase/messages.sql — an inbound GHL reply appears in an open thread
// without a manual reload), client_notes (supabase/realtime-client-
// notes.sql — the Chat tab, so a teammate's message shows up live), and
// team_messages (supabase/team-chat.sql — Team Chat is pointless without live updates),
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

export function subscribeRealtime(handlers: {
  onTask: (p: Payload) => void;
  onClient: (p: Payload) => void;
  onNotification: (p: Payload) => void;
  onMessage: (p: Payload) => void;
  onClientNote: (p: Payload) => void;
  onTeamMessage: (p: Payload) => void;
  onDmMessage: (p: Payload) => void;
  onStatusChange?: (status: string) => void;
}): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let torn = false;

  const connect = () => {
    channel = supabase
      .channel("rt:app")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, handlers.onTask)
      .on("postgres_changes", { event: "*", schema: "public", table: "clients" }, handlers.onClient)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, handlers.onNotification)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, handlers.onMessage)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_notes" }, handlers.onClientNote)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_messages" }, handlers.onTeamMessage)
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_messages" }, handlers.onDmMessage)
      .subscribe((status) => {
        handlers.onStatusChange?.(status);
        if (status === "SUBSCRIBED") retries = 0;
        if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !torn) {
          retries += 1;
          const delay = Math.min(1000 * 2 ** retries, 15000);
          retryTimer = setTimeout(() => {
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
    if (channel) supabase.removeChannel(channel);
  };
}
