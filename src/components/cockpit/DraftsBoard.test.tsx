import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DraftsBoard } from "./DraftsBoard";
import { buildPendingSends, type ClientDraftInput, type ScheduledInput, type TaskDraftInput } from "@/lib/pendingSends";
import type { EmailDraft } from "@/lib/data";

// The board itself, rendered: that the two groups appear in the right order,
// that a row says where its email lives and shows a bit of it, and that
// clicking one goes to the task or the client it was written on. Built from the
// same buildPendingSends the app uses, so the fixture cannot drift.

const NOW = Date.parse("2026-09-15T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();
const draft = (over: Partial<EmailDraft> = {}): EmailDraft => ({
  subject: "Following up", body: "<p>Hi there</p>", createdAt: ago(1), updatedAt: ago(1), ...over,
});
const onTask = (taskId: string, d: Partial<EmailDraft> = {}): TaskDraftInput => ({ taskId, clientId: "c_1", draft: draft(d) });
const onClient = (clientId: string, d: Partial<EmailDraft> = {}): ClientDraftInput => ({ clientId, draft: draft(d), updatedAt: ago(1) });
const queued = (id: string, at: string, over: Partial<ScheduledInput> = {}): ScheduledInput => ({
  id, clientId: "c_1", taskId: null, channel: "email", subject: "Later", body: "<p>Soon</p>", scheduledAt: at, ...over,
});

let root: Root | null = null;
let host: HTMLDivElement;
function render(ui: React.ReactElement) {
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

const context = () => ({ clientName: "Acme", taskTitle: "Fix the footer" });
const board = (groups: ReturnType<typeof buildPendingSends>, over: Partial<React.ComponentProps<typeof DraftsBoard>> = {}) => (
  <DraftsBoard groups={groups} loading={false} rowContext={context} onOpen={() => {}} onRefresh={() => {}} {...over} />
);

describe("the Drafts board", () => {
  it("puts what sends itself above what needs a person", () => {
    const g = buildPendingSends([onTask("t_1")], [], [queued("s_1", inDays(1))], NOW);
    render(board(g));
    expect(text()).toContain("Scheduled to send");
    expect(text()).toContain("Drafts");
    expect(text()).toContain("2 written and not sent.");
    expect(rows()).toHaveLength(2);
  });

  it("reads drafts oldest first, so the forgotten one is at the top", () => {
    const g = buildPendingSends(
      [onTask("fresh", { subject: "Written today", updatedAt: ago(0) }), onTask("old", { subject: "Written nine days ago", updatedAt: ago(9) })],
      [], [], NOW,
    );
    render(board(g));
    expect(rows().map((b) => b.textContent)).toEqual([
      expect.stringContaining("Written nine days ago"),
      expect.stringContaining("Written today"),
    ]);
  });

  it("says which of the two places a draft was written, and does not badge a queued one", () => {
    const g = buildPendingSends([onTask("t_1")], [onClient("c_2")], [queued("s_1", inDays(1))], NOW);
    render(board(g));
    const all = rows().map((b) => b.textContent ?? "");
    expect(all.join(" | ")).toContain("On a task");
    expect(all.join(" | ")).toContain("On the client");
    // Its group heading already says it is queued.
    expect(all[0]).not.toContain("Queued");
  });

  it("dates a queued send but ages a draft, because the questions differ", () => {
    const g = buildPendingSends([onTask("t_1", { updatedAt: ago(9) })], [], [queued("s_1", inDays(1))], NOW);
    render(board(g));
    // Soonest-first scheduled group renders above the drafts group.
    expect(rows()[0].textContent).toMatch(/Sep 1[67]/);
    expect(rows()[1].textContent).toContain("9 days");
  });

  it("flags a scheduled send that should have gone already", () => {
    const g = buildPendingSends([], [], [queued("late", ago(1)), queued("soon", inDays(1))], NOW);
    render(board(g));
    expect(rows()[0].textContent).toContain("Overdue");
    expect(rows()[1].textContent).not.toContain("Overdue");
  });

  it("shows a bit of the body, as plain text", () => {
    const g = buildPendingSends([onTask("t_1", { body: "<p>Hi Sam,</p><p>Here is the <strong>draft</strong>.</p>" })], [], [], NOW);
    render(board(g));
    expect(rows()[0].textContent).toContain("Hi Sam, Here is the draft.");
    expect(rows()[0].innerHTML).not.toContain("<strong>");
  });

  it("names a client and task, and copes when neither is loaded", () => {
    const g = buildPendingSends([onTask("t_1")], [], [], NOW);
    render(board(g));
    expect(rows()[0].textContent).toContain("Acme · Fix the footer");

    act(() => root!.render(board(g, { rowContext: () => null })));
    expect(rows()[0].textContent).toContain("On something you cannot see");
  });

  it("opens the task a draft is on, and the client when it is not on a task", () => {
    const onOpen = vi.fn();
    const g = buildPendingSends([onTask("t_9")], [onClient("c_2", { subject: "Client one", updatedAt: ago(5) })], [], NOW);
    render(board(g, { onOpen }));
    // Oldest first, so the client draft is the top row.
    act(() => { rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "client_draft", taskId: null, clientId: "c_2" }));
    act(() => { rows()[1].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "task_draft", taskId: "t_9" }));
  });

  it("heads a queued text message with its own words, once", () => {
    const g = buildPendingSends([], [], [queued("s_1", inDays(1), { channel: "sms", subject: null, body: "Running late" })], NOW);
    render(board(g));
    const row = rows()[0].textContent ?? "";
    expect(row).toContain("Text");
    expect(row.match(/Running late/g)).toHaveLength(1);
  });

  it("says plainly when nothing is waiting, and not while it is still looking", () => {
    const empty = buildPendingSends([], [], [], NOW);
    render(board(empty));
    expect(text()).toContain("Nothing is written and waiting");

    act(() => root!.render(board(empty, { loading: true })));
    expect(text()).toContain("Checking what is waiting…");
    expect(text()).not.toContain("Nothing is written and waiting");
  });

  it("asks again when Refresh is pressed", () => {
    const onRefresh = vi.fn();
    render(board(buildPendingSends([], [], [], NOW), { onRefresh }));
    act(() => { refreshButton().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
