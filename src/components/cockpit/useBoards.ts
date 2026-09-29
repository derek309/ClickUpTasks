"use client";

// The My Work boards that load on demand (Reviews, Drafts) and the Finished
// marker, lifted out of Cockpit.tsx unchanged (audit 2026-09-29, 3.4).
import { useEffect, useMemo, useState, type RefObject } from "react";
import { authedFetch } from "@/lib/supabase";
import { fetchOpenReviews, fetchVideoStorage, fetchClientEmailDrafts, fetchFeedSeen, markFeedSeenDb, rowToScheduledMessage } from "@/lib/db";
import { finishKindOf, PERSONAL_CLIENT_ID, type ScheduledMessage, type Task } from "@/lib/data";
import { buildOpenReviews, type OpenReviewGroups } from "@/lib/openReviews";
import { buildPendingSends, type PendingSendGroups } from "@/lib/pendingSends";

export function useBoards({ tasks, tasksRef, showingBoard, meId }: {
  tasks: Task[];
  /** The live task list, read when a board loads. */
  tasksRef: RefObject<Task[]>;
  /** The My Work board on screen, or null when My Work is not. */
  showingBoard: "work" | "reviews" | "drafts" | null;
  meId: string;
}) {
  // What is out with a client, for the Reviews tab. Loaded when that tab is
  // opened rather than at boot: a document is otherwise read one task at a
  // time (supabase/task-documents.sql), and the board is two small queries
  // that would be wasted on every other visit.
  const [openReviews, setOpenReviews] = useState<OpenReviewGroups>({ yourMove: [], withClient: [], approved: [] });
  const [reviewsLoading, setReviewsLoading] = useState(false);
  // What video is costing in storage, loaded with the board that shows it.
  const [videoStorage, setVideoStorage] = useState<{ files: number; bytes: number } | null>(null);
  const loadOpenReviews = async () => {
    setReviewsLoading(true);
    void fetchVideoStorage().then(setVideoStorage).catch(() => {});
    try {
      const { docs, versions } = await fetchOpenReviews();
      // Only reviews on a task that is still here. Row level security scopes
      // task_documents by the task's own rule, which says nothing about the
      // trash, so a review on a task someone binned stays "out with the
      // client" until the purge takes it thirty days later. The loaded tasks
      // are the live ones, so being among them is the test.
      const live = new Set(tasksRef.current.map((t) => t.id));
      setOpenReviews(buildOpenReviews(docs.filter((d) => live.has(d.taskId)), versions));
    } catch {
      // Best effort, same as the other on-demand loads: the board says nothing
      // is out rather than showing an error nobody can act on.
    } finally {
      setReviewsLoading(false);
    }
  };

  // Everything written and not sent, for the Drafts tab. Task drafts are
  // already in memory on the tasks themselves; the client drafts and the
  // scheduled queue are fetched when the tab is opened.
  const [pendingSends, setPendingSends] = useState<PendingSendGroups>({ scheduled: [], drafts: [] });
  const [draftsLoading, setDraftsLoading] = useState(false);
  const loadPendingSends = async () => {
    setDraftsLoading(true);
    try {
      const [clientDrafts, scheduledRes] = await Promise.all([
        fetchClientEmailDrafts(),
        authedFetch("/api/messages/schedule").then((r) => (r.ok ? r.json() : { scheduled: [] })).catch(() => ({ scheduled: [] })),
      ]);
      const taskDrafts = tasksRef.current
        .filter((t) => t.draftEmail)
        .map((t) => ({ taskId: t.id, clientId: t.clientId, draft: t.draftEmail! }));
      const queued = (scheduledRes.scheduled ?? []).map(rowToScheduledMessage) as ScheduledMessage[];
      setPendingSends(buildPendingSends(taskDrafts, clientDrafts, queued));
    } catch {
      // Best effort, like the other on-demand loads.
    } finally {
      setDraftsLoading(false);
    }
  };

  // Re-read every time the tab is opened rather than once. It is two small
  // queries, and a board of what is waiting is worth nothing if it is showing
  // what was waiting an hour ago. Deferred a frame, the same way
  // NotificationPrefsPanel defers its own load: the first thing it does is set
  // the loading flag, and writing state straight from an effect body is what
  // stops the compiler optimising the component around it.
  useEffect(() => {
    if (showingBoard !== "drafts" && showingBoard !== "reviews") return;
    const r = requestAnimationFrame(() => { void (showingBoard === "drafts" ? loadPendingSends() : loadOpenReviews()); });
    return () => cancelAnimationFrame(r);
    // The loaders read the live task list through the ref, so they are not
    // dependencies: only opening the tab reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingBoard]);

  // When this person last looked at Finished. finishedSeenAt is what the count
  // is measured against and only moves when they look again; markerAt is frozen
  // for the visit, so the "new since you last looked" line stays where it was
  // instead of vanishing as the view opens.
  const [finishedSeenAt, setFinishedSeenAt] = useState<string | null>(null);
  const [finishedMarkerAt, setFinishedMarkerAt] = useState<string | null>(null);
  useEffect(() => {
    void fetchFeedSeen(meId, "finished").then(setFinishedSeenAt);
  }, [meId]);
  // Opening it is looking at it: freeze the marker where it is, then move the
  // stored mark to now so the count is clear next time. Done where the opening
  // happens rather than in an effect watching for it: it is one action by a
  // person, and an effect would be a second, later guess at when that was.
  const openFinished = () => {
    setFinishedMarkerAt(finishedSeenAt);
    const now = new Date().toISOString();
    setFinishedSeenAt(now);
    markFeedSeenDb(meId, "finished", now);
  };
  // How much has finished since they last looked, for the button's own count.
  // Runs whatever view is open, so it has to stay cheap: the time comparison
  // comes first and settles almost every comment before finishKindOf ever
  // runs a regex over it.
  const newFinishedCount = useMemo(() => {
    if (!finishedSeenAt) return 0;
    let n = 0;
    for (const t of tasks) {
      if (t.clientId === PERSONAL_CLIENT_ID) continue;
      for (const c of t.comments) {
        if (c.kind !== "event" || c.at <= finishedSeenAt) continue;
        if (finishKindOf(c.body, c.authorId)) n += 1;
      }
    }
    return n;
  }, [tasks, finishedSeenAt]);

  return {
    openReviews, reviewsLoading, videoStorage, loadOpenReviews,
    pendingSends, draftsLoading, loadPendingSends,
    finishedMarkerAt, openFinished, newFinishedCount,
  };
}
