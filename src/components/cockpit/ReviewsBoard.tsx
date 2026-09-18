"use client";

// "Reviews" — everything out with a client, across every client at once.
//
// Every piece of this was already recorded and there was nowhere to see it:
// which reviews are out, how long they have been sitting, whether the client
// ever opened the link, and which ones came back with changes. You had to
// remember which task carried which review and open them one at a time, so the
// one nobody had touched in nine days was the one nobody looked at.
//
// Two groups, and the order inside them is the point (see buildOpenReviews):
// what the client sent back is ours to act on and reads newest first; what we
// are waiting on reads OLDEST first, so the one going stale is at the top.
import { I } from "./ui";
import { kindTitle } from "@/lib/reviewKinds";
import { APPROVED_DAYS, type OpenReview, type OpenReviewGroups } from "@/lib/openReviews";
import { waitedFor } from "@/lib/elapsed";
import { formatFileSize } from "@/lib/uploadTypes";

export type ReviewsBoardProps = {
  groups: OpenReviewGroups;
  loading: boolean;
  /** Video stored right now, or null while it is not known. Video is the only
   *  thing here big enough to be worth watching, and this is the one place in the
   *  app that says so (docs/video-review-plan.md). */
  videoStorage?: { files: number; bytes: number } | null;
  /** Task title and client name for a review's task, or null if it is not loaded. */
  taskContext: (taskId: string) => { taskTitle: string; clientName: string } | null;
  onOpenTask: (taskId: string) => void;
  onRefresh: () => void;
};

// A review is stale when it has been sitting longer than a client reasonably
// takes. Same threshold the reminder cron uses to draft a nudge, so the board
// and the nudge agree about what "too long" means.
const STALE_DAYS = 3;

/** When it was approved. waitedFor says how long something has been waiting,
 *  which is the wrong sentence for work that is finished. */
const approvedAgo = (days: number | null): string =>
  (days === null ? "" : days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`);

function Row({ r, context, onOpen }: { r: OpenReview; context: { taskTitle: string; clientName: string } | null; onOpen: () => void }) {
  const stale = r.status === "with_client" && r.days !== null && r.days >= STALE_DAYS;
  return (
    // On a phone the chips drop under the name instead of competing with it for
    // one line: at 375px a long review name was squeezed to "Bib..." and the
    // badge beside it ran under the "Not opened" chip.
    <button type="button" onClick={onOpen}
      className="flex w-full flex-col gap-1.5 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent-soft/50 sm:flex-row sm:items-center sm:gap-3">
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 max-w-full truncate text-[16px] font-medium">{r.name}</span>
          {/* Nobody named this one, so its name already IS the kind and the
              badge would print "Client document  Client document". */}
          {r.name !== kindTitle(r.kind) && (
            <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[16px] text-muted">{kindTitle(r.kind)}</span>
          )}
          {r.version > 1 && <span className="shrink-0 text-[16px] text-muted">v{r.version}</span>}
          {/* Two emails in one HTML review, or a front and back, say so (Derek, 2026-09-16). */}
          {(r.parts ?? 0) > 1 && <span className="shrink-0 text-[16px] text-muted">{r.parts} {r.kind === "page" ? "pages" : r.kind === "video" ? "videos" : "images"}</span>}
        </span>
        <span className="mt-0.5 block truncate text-[16px] text-muted">
          {context ? `${context.clientName} · ${context.taskTitle}` : "On a task you cannot see"}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {/* Who approved it. The client clicking Approve is the news; the team
            closing it out on their say so is worth telling apart, because it
            means nobody at the client's end has actually looked. */}
        {r.status === "approved" && (
          <span className={`rounded px-2 py-0.5 text-[16px] font-medium ${r.approvedByTeam ? "bg-background text-muted" : "bg-emerald-50 text-emerald-700"}`}
            title={r.approvedByTeam ? "Someone on the team marked this approved for the client" : "The client approved it themselves"}>
            {r.approvedByTeam ? "We approved" : "Client approved"}
          </span>
        )}
        {r.status === "with_client" && (
          <span className={`rounded px-2 py-0.5 text-[16px] font-medium ${r.opened ? "bg-background text-muted" : "bg-amber-50 text-amber-700"}`}
            title={r.opened ? "The client has opened the link" : "The client has not opened the link yet"}>
            {r.opened ? "Opened" : "Not opened"}
          </span>
        )}
        <span className={`text-right text-[16px] ${stale ? "font-semibold text-amber-700" : "text-muted"}`}>
          {r.status === "approved" ? approvedAgo(r.days) : waitedFor(r.days)}
        </span>
      </span>
    </button>
  );
}

function Group({ title, help, rows, taskContext, onOpenTask }: {
  title: string; help: string; rows: OpenReview[];
  taskContext: ReviewsBoardProps["taskContext"]; onOpenTask: (taskId: string) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
      <div className="flex items-center gap-2 border-b bg-background/40 px-4 py-2.5">
        <span className="text-[17px] font-bold">{title}</span>
        <span className="rounded-[5px] bg-border px-1.5 text-[16px] font-semibold text-foreground">{rows.length}</span>
        <span className="ml-2 hidden truncate text-[16px] text-muted sm:inline">{help}</span>
      </div>
      {rows.map((r) => (
        <Row key={r.id} r={r} context={taskContext(r.taskId)} onOpen={() => onOpenTask(r.taskId)} />
      ))}
    </div>
  );
}

export function ReviewsBoard({ groups, loading, taskContext, onOpenTask, onRefresh, videoStorage }: ReviewsBoardProps) {
  const total = groups.yourMove.length + groups.withClient.length;
  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[16px] text-muted">
          {loading ? "Checking what is out…" : total === 0 ? "Nothing is out with a client." : `${total} review${total === 1 ? "" : "s"} out with a client.`}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={onRefresh} disabled={loading} title="Check again"
          className="inline-flex items-center gap-1.5 rounded-md border bg-surface px-2.5 py-1.5 text-[16px] font-medium text-muted hover:text-foreground disabled:opacity-50">
          <I.repeat className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* One line, because until now nothing in the app said what storage was being
          used and video is the first thing big enough to matter. */}
      {!!videoStorage && videoStorage.files > 0 && (
        <p className="mb-3 text-[16px] text-muted">
          {videoStorage.files} video{videoStorage.files === 1 ? "" : "s"} stored, {formatFileSize(videoStorage.bytes)}. A video is cleared 30 days after its review is approved.
        </p>
      )}

      <div className="flex flex-col gap-4">
        <Group title="Your move" help="The client sent changes back." rows={groups.yourMove} taskContext={taskContext} onOpenTask={onOpenTask} />
        <Group title="Waiting on the client" help="Longest wait first." rows={groups.withClient} taskContext={taskContext} onOpenTask={onOpenTask} />
        {/* Nothing to do here, but before this an approved review just stopped
            being listed, so coming back approved and never coming back looked
            exactly the same (Derek, 2026-09-18). */}
        <Group title="Approved" help={`Came back in the last ${APPROVED_DAYS} days. Newest first.`} rows={groups.approved} taskContext={taskContext} onOpenTask={onOpenTask} />
        {!loading && total === 0 && (
          <div className="rounded-xl border bg-surface py-16 text-center text-[16px] text-muted shadow-soft">
            Nothing is waiting on a client right now. Reviews appear here the moment one is sent.
          </div>
        )}
      </div>
    </div>
  );
}
