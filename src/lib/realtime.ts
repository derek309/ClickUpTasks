// Supabase Realtime wiring — pure channel setup/teardown, no app state here.
// Cockpit.tsx owns all React state and decides how to merge incoming rows.
// Subscribes to tasks/clients/notifications (see supabase/realtime.sql and
// the plan doc for why those three and not all 7 domain tables), messages
// (supabase/messages.sql — an inbound GHL reply appears in an open thread
// without a manual reload), client_notes (supabase/realtime-client-
// notes.sql — the Chat tab, so a teammate's message shows up live), and
// team_messages (supabase/team-chat.sql — Team Chat is pointless without live updates).
import { supabase } from "./supabase";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export type Payload = RealtimePostgresChangesPayload<Record<string, unknown>>;

// supabase-js does not auto-resubscribe a channel after CHANNEL_ERROR/
// TIMED_OUT — this reconnects with exponential backoff (1s→15s cap),
// independently per table so one channel's trouble doesn't tear down others.
function subscribeOne(table: string, onEvent: (p: Payload) => void, onStatus?: (s: string) => void) {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let torn = false;

  const connect = () => {
    channel = supabase
      .channel(`rt:${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, onEvent)
      .subscribe((status) => {
        onStatus?.(status);
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

export function subscribeRealtime(handlers: {
  onTask: (p: Payload) => void;
  onClient: (p: Payload) => void;
  onNotification: (p: Payload) => void;
  onMessage: (p: Payload) => void;
  onClientNote: (p: Payload) => void;
  onTeamMessage: (p: Payload) => void;
  onStatusChange?: (status: string) => void;
}): () => void {
  const unsubs = [
    subscribeOne("tasks", handlers.onTask, handlers.onStatusChange),
    subscribeOne("clients", handlers.onClient),
    subscribeOne("notifications", handlers.onNotification),
    subscribeOne("messages", handlers.onMessage),
    subscribeOne("client_notes", handlers.onClientNote),
    subscribeOne("team_messages", handlers.onTeamMessage),
  ];
  return () => unsubs.forEach((u) => u());
}
