import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReviewsBoard } from "./ReviewsBoard";
import { buildOpenReviews, type OpenReviewDoc, type ReviewVersionRow } from "@/lib/openReviews";

// The board itself, rendered: that both groups appear in the right order, that
// a row says who it belongs to and how long it has sat, and that clicking one
// opens its task. Built from the same buildOpenReviews the app uses, so the
// fixture cannot drift from what really reaches the component.

const NOW = Date.parse("2026-09-15T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const doc = (over: Partial<OpenReviewDoc> & { id: string }): OpenReviewDoc => ({
  taskId: `t_${over.id}`, kind: "doc", title: "A document", status: "with_client",
  version: 1, clientViewedAt: null, ...over,
});

let root: Root | null = null;
let host: HTMLDivElement;

function render(ui: Parameters<typeof createRoot>[0] extends never ? never : React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}
const text = () => host.textContent ?? "";
const refreshButton = () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Refresh"))!;
const rows = () => Array.from(host.querySelectorAll("button")).filter((b) => !b.textContent?.includes("Refresh"));

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
});

const context = (taskId: string) => ({ taskTitle: `Task ${taskId}`, clientName: "Acme" });

describe("the Reviews board", () => {
  it("shows what they sent back above what we are waiting on, oldest wait first", () => {
    const groups = buildOpenReviews(
      [
        doc({ id: "fresh", title: "Sent today" }),
        doc({ id: "stale", title: "Sent nine days ago" }),
        doc({ id: "back", title: "They replied", status: "client_submitted" }),
      ],
      [
        { documentId: "fresh", kind: "sent", createdAt: ago(0) },
        { documentId: "stale", kind: "sent", createdAt: ago(9) },
        { documentId: "back", kind: "client_submitted", createdAt: ago(1) } as ReviewVersionRow,
      ],
      NOW,
    );
    render(<ReviewsBoard groups={groups} loading={false} taskContext={context} onOpenTask={() => {}} onRefresh={() => {}} />);

    expect(text()).toContain("Your move");
    expect(text()).toContain("Waiting on the client");
    expect(text()).toContain("3 reviews out with a client.");
    expect(rows().map((b) => b.textContent)).toEqual([
      expect.stringContaining("They replied"),
      expect.stringContaining("Sent nine days ago"),
      expect.stringContaining("Sent today"),
    ]);
    expect(rows()[1].textContent).toContain("9 days");
    expect(rows()[2].textContent).toContain("today");
  });

  it("names the client and the task each review belongs to", () => {
    const groups = buildOpenReviews([doc({ id: "a", title: "Fall flyer" })], [{ documentId: "a", kind: "sent", createdAt: ago(2) }], NOW);
    render(<ReviewsBoard groups={groups} loading={false} taskContext={context} onOpenTask={() => {}} onRefresh={() => {}} />);
    expect(rows()[0].textContent).toContain("Acme");
    expect(rows()[0].textContent).toContain("Task t_a");
  });

  it("says when the client has not opened it, and does not ask that of our own queue", () => {
    const groups = buildOpenReviews(
      [doc({ id: "unseen" }), doc({ id: "seen", clientViewedAt: ago(1) }), doc({ id: "ours", status: "client_submitted" })],
      [
        { documentId: "unseen", kind: "sent", createdAt: ago(2) },
        { documentId: "seen", kind: "sent", createdAt: ago(3) },
        { documentId: "ours", kind: "client_submitted", createdAt: ago(1) } as ReviewVersionRow,
      ],
      NOW,
    );
    render(<ReviewsBoard groups={groups} loading={false} taskContext={context} onOpenTask={() => {}} onRefresh={() => {}} />);
    const all = rows().map((b) => b.textContent ?? "");
    expect(all.filter((t) => t.includes("Not opened"))).toHaveLength(1);
    expect(all.filter((t) => t.includes("Opened") && !t.includes("Not opened"))).toHaveLength(1);
    // The first row is ours; whether they opened it is not the question there.
    expect(all[0]).not.toContain("Opened");
  });

  it("falls back to the kind's name when nobody named the review", () => {
    const groups = buildOpenReviews([doc({ id: "a", title: "", kind: "page" })], [{ documentId: "a", kind: "sent", createdAt: ago(1) }], NOW);
    render(<ReviewsBoard groups={groups} loading={false} taskContext={context} onOpenTask={() => {}} onRefresh={() => {}} />);
    expect(rows()[0].textContent).toContain("HTML review");
  });

  it("opens the task a review belongs to when its row is clicked", () => {
    const onOpenTask = vi.fn();
    const groups = buildOpenReviews([doc({ id: "a" })], [{ documentId: "a", kind: "sent", createdAt: ago(1) }], NOW);
    render(<ReviewsBoard groups={groups} loading={false} taskContext={context} onOpenTask={onOpenTask} onRefresh={() => {}} />);
    act(() => { rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onOpenTask).toHaveBeenCalledWith("t_a");
  });

  it("says plainly when nothing is out, and does not say it while still looking", () => {
    const empty = buildOpenReviews([], [], NOW);
    render(<ReviewsBoard groups={empty} loading={false} taskContext={context} onOpenTask={() => {}} onRefresh={() => {}} />);
    expect(text()).toContain("Nothing is waiting on a client right now");

    act(() => root!.render(<ReviewsBoard groups={empty} loading taskContext={context} onOpenTask={() => {}} onRefresh={() => {}} />));
    expect(text()).toContain("Checking what is out…");
    expect(text()).not.toContain("Nothing is waiting on a client right now");
  });

  it("survives a review on a task this person cannot see", () => {
    const groups = buildOpenReviews([doc({ id: "a", title: "Hidden" })], [{ documentId: "a", kind: "sent", createdAt: ago(1) }], NOW);
    render(<ReviewsBoard groups={groups} loading={false} taskContext={() => null} onOpenTask={() => {}} onRefresh={() => {}} />);
    expect(rows()[0].textContent).toContain("On a task you cannot see");
  });

  it("asks again when Refresh is pressed", () => {
    const onRefresh = vi.fn();
    render(<ReviewsBoard groups={buildOpenReviews([], [], NOW)} loading={false} taskContext={context} onOpenTask={() => {}} onRefresh={onRefresh} />);
    act(() => { refreshButton().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
