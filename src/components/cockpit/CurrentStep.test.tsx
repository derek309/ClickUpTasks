import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CurrentStep } from "./CurrentStep";
import { WhatsNext } from "./WhatsNext";
import { CLAUDE_ID, type Subtask } from "@/lib/data";

// The working step card and What's next after it (Derek, 2026-10-17,
// step-done-then-next-mockup.html).

beforeAll(() => {
  // jsdom has no ResizeObserver (the description's Read more measures itself).
  if (!("ResizeObserver" in globalThis)) (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
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
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
});
const buttons = (label: string) => Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === label);
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

const step = (p: Partial<Subtask> = {}): Subtask => ({ id: "s1", title: "Hand off", done: false, ...p } as Subtask);
function card(sub: Subtask, p: Partial<React.ComponentProps<typeof CurrentStep>> = {}) {
  const onMarkDone = vi.fn();
  const onLastTick = vi.fn();
  render(<CurrentStep sub={sub} number={1} showName firstName="Brian" tone={{ say: "Michaella's turn", word: "Michaella's turn", sayTone: "" }}
    meId="u_derek" messages={[]} onPatchSub={vi.fn()} onRename={vi.fn()} onMarkDone={onMarkDone} onLastTick={onLastTick} onOpenStep={vi.fn()}
    sentence={<div>Michaella&apos;s turn, due Oct 15</div>} {...p} />);
  return { onMarkDone, onLastTick };
}

describe("the working step card", () => {
  it("shows the step, its Description, its Checklist and one Done, and nothing about what comes next", () => {
    card(step({ notes: "<p>Send it to both store lists.</p>", todos: [{ id: "t1", title: "Send to stores unopened", done: true }, { id: "t2", title: "Send to stores opened", done: false }] }));
    const text = host.textContent ?? "";
    expect(text).toContain("Description");
    expect(text).toContain("Send it to both store lists.");
    expect(text).toContain("Checklist");
    expect(buttons("Done")).toHaveLength(1);
    for (const gone of ["Next step", "Leave it with", "Mark it done anyway", "Delegate", "Open the step", "Directions"]) expect(text).not.toContain(gone);
    // Description sits above the Checklist.
    expect(text.indexOf("Description")).toBeLessThan(text.indexOf("Checklist"));
  });
  it("shows no empty Description or Checklist", () => {
    card(step());
    const text = host.textContent ?? "";
    expect(text).not.toContain("Description");
    expect(text).not.toContain("Checklist");
    expect(buttons("Done")).toHaveLength(1);
  });
  it("ticking the last to do is Done, once", () => {
    const { onLastTick } = card(step({ todos: [{ id: "t1", title: "One", done: true }, { id: "t2", title: "Two", done: false }] }));
    click(host.querySelector('[aria-label="Mark Two done"]')!);
    expect(onLastTick).toHaveBeenCalledTimes(1);
  });
  it("ticking one of several open to dos is not", () => {
    const { onLastTick } = card(step({ todos: [{ id: "t1", title: "One", done: false }, { id: "t2", title: "Two", done: false }] }));
    click(host.querySelector('[aria-label="Mark Two done"]')!);
    expect(onLastTick).not.toHaveBeenCalled();
  });
  it("a client's turn leads with what we need from them, in its own box", () => {
    card(step({ notes: "<p>Reply OK, or tell us what to change.</p>" }), { describe: { label: "What we need from Brian", tone: "client" } });
    const box = host.querySelector('section[aria-label="What we need from Brian"]');
    expect(box?.textContent).toContain("Reply OK");
    expect(box?.className).toContain("bg-orange-50");
  });
  it("Claude's turn leads with what Claude should do", () => {
    card(step({ assigneeId: CLAUDE_ID, notes: "<p>Write 5 subject lines.</p>" }), { describe: { label: "What Claude should do", tone: "claude" } });
    expect(host.querySelector('section[aria-label="What Claude should do"]')?.className).toContain("bg-violet-50");
  });
});

describe("What's next, after Done", () => {
  const choices = [{ key: "u_derek", label: "You" }, { key: "u_justin", label: "Justin" }, { key: CLAUDE_ID, label: "Claude" }, { key: "client", label: "Brian" }];
  const nameOf = (id: string) => (id === "u_justin" ? "Justin" : "Someone");
  function form(p: Partial<React.ComponentProps<typeof WhatsNext>> = {}) {
    const onSave = vi.fn();
    const onCloseTask = vi.fn();
    render(<WhatsNext done="✓ Hand off · done by Michaella" who="u_derek" due="2026-10-19" choices={choices} meId="u_derek" clientFirst="Brian" nameOf={nameOf}
      today="2026-10-17" onSave={onSave} onCloseTask={onCloseTask} {...p} />);
    return { onSave, onCloseTask };
  }
  it("folds the step to one line and asks with the turn line, Your turn by default", () => {
    form({ suggestion: "Send the newsletter to Brian to approve" });
    const text = host.textContent ?? "";
    expect(text).toContain("✓ Hand off · done by Michaella");
    expect(text).toContain("What's next?");
    expect(text).toContain("Your turn");
    expect((host.querySelector('input[aria-label="The next step"]') as HTMLInputElement).placeholder).toBe("Send the newsletter to Brian to approve");
    expect(buttons("Save")).toHaveLength(1);
    expect(buttons("Nothing next, close the task")).toHaveLength(1);
  });
  it("the button follows whose turn it starts as", () => {
    form({ who: "client", name: "Approve the newsletter" });
    expect(buttons("Write Brian's email")).toHaveLength(1);
    expect(host.textContent).toContain("We email Brian the ask and wait for the reply.");
  });
  it("saves the suggestion when nothing is typed", () => {
    const { onSave } = form({ suggestion: "Pick the hero photo" });
    click(buttons("Save")[0]);
    expect(onSave).toHaveBeenCalledWith({ name: "Pick the hero photo", who: "u_derek", due: "2026-10-19", waits: false });
  });
  it("needs a name before it saves", () => {
    const { onSave } = form();
    expect((buttons("Save")[0] as HTMLButtonElement).disabled).toBe(true);
    click(buttons("Save")[0]);
    expect(onSave).not.toHaveBeenCalled();
  });
  it("a wait on the client's reply waits, with no email to write", () => {
    form({ who: "client", suggestion: "Wait for Brian's reply", waitName: "Wait for Brian's reply" });
    expect(buttons("Wait for Brian")).toHaveLength(1);
  });
  it("Nothing next closes the task", () => {
    const { onCloseTask } = form();
    click(buttons("Nothing next, close the task")[0]);
    expect(onCloseTask).toHaveBeenCalledTimes(1);
  });
});
