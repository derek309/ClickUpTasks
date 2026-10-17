import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CurrentStep } from "./CurrentStep";
import { WhatsNext } from "./WhatsNext";
import { StepPage } from "./StepPage";
import { CLAUDE_ID, type Subtask, type Task } from "@/lib/data";

// The step on the task view (it reads), its page (where it is worked) and
// What's next after Done (Derek, 2026-10-17, step-done-then-next-mockup.html).

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
const pageButtons = (label: string) => Array.from(document.body.querySelectorAll("button")).filter((b) => b.textContent?.trim() === label);

describe("the step on the task view reads, it does nothing (Derek, 2026-10-17)", () => {
  function card(p: Partial<React.ComponentProps<typeof CurrentStep>> = {}) {
    const onOpenStep = vi.fn();
    render(<CurrentStep number={1} title="Hand off" showName line="Carol's turn, need by Fri, Oct 16, reminded every 3 days" quiet="Draft · not given to Michaella yet" onOpenStep={onOpenStep} {...p} />);
    return { onOpenStep };
  }
  it("shows the number, the name, the turn line and one quiet line, and no action buttons", () => {
    card();
    const text = host.textContent ?? "";
    expect(text).toContain("1.Hand off");
    expect(text).toContain("Carol's turn, need by Fri, Oct 16, reminded every 3 days");
    expect(text).toContain("Draft · not given to Michaella yet");
    // One button: the card itself, which opens the step's page.
    expect(host.querySelectorAll("button")).toHaveLength(1);
    for (const gone of ["Done", "Give to", "Reply", "+ Add", "Send", "Text Carol"]) expect(buttons(gone)).toHaveLength(0);
  });
  it("a click anywhere on it opens the step's page", () => {
    const { onOpenStep } = card();
    click(host.querySelector("button")!);
    expect(onOpenStep).toHaveBeenCalledTimes(1);
  });
  it("shows the step's latest message, so a message that went shows it went", () => {
    card({ message: { text: "You to Michaella: Did this one get sent out? · just now" } });
    expect(host.textContent).toContain("You to Michaella: Did this one get sent out? · just now");
  });
  it("an open question for you reads as Question from Michaella, in amber", () => {
    card({ message: { text: "Which list?", questionFrom: "Michaella" } });
    const label = Array.from(host.querySelectorAll("span")).find((x) => x.textContent === "Question from Michaella");
    expect(label?.className).toContain("text-amber-800");
  });
});

describe("the working happens on the step's page", () => {
  const task = { id: "t1", title: "Stores newsletter", clientId: "cl_1", subtasks: [], attachments: [], comments: [], createdAt: "2026-10-01T00:00:00Z" } as unknown as Task;
  function page(sub: Subtask, p: Partial<React.ComponentProps<typeof StepPage>> = {}) {
    const onMarkDone = vi.fn();
    const onLastTick = vi.fn();
    render(<StepPage task={{ ...task, subtasks: [sub] } as Task} sub={sub} client={{ name: "Brian Smith", color: "#123456" }} firstName="Brian" isCurrent full={false}
      onToggleFull={vi.fn()} onClose={vi.fn()} onRename={vi.fn()} onPatchSub={vi.fn()} onMarkDone={onMarkDone} onLastTick={onLastTick} onReopen={vi.fn()}
      messages={[]} actions={[]} canChat={false} onAddNote={vi.fn()} {...p} />);
    return { onMarkDone, onLastTick };
  }
  it("shows the step, its Description, its Checklist and one Done, and nothing about what comes next", () => {
    page(step({ notes: "<p>Send it to both store lists.</p>", todos: [{ id: "t1", title: "Send to stores unopened", done: true }, { id: "t2", title: "Send to stores opened", done: false }] }));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Description");
    expect(text).toContain("Send it to both store lists.");
    expect(text).toContain("Checklist");
    expect(pageButtons("Done")).toHaveLength(1);
    for (const gone of ["Next step", "Leave it with", "Mark it done anyway", "Delegate"]) expect(text).not.toContain(gone);
    expect(text.indexOf("Description")).toBeLessThan(text.indexOf("Checklist"));
  });
  it("Done is pressed on the page", () => {
    const { onMarkDone } = page(step());
    click(pageButtons("Done")[0]);
    expect(onMarkDone).toHaveBeenCalledTimes(1);
  });
  it("ticking the last to do is Done, once", () => {
    const { onLastTick } = page(step({ todos: [{ id: "t1", title: "One", done: true }, { id: "t2", title: "Two", done: false }] }));
    click(document.body.querySelector('[aria-label="Mark Two done"]')!);
    expect(onLastTick).toHaveBeenCalledTimes(1);
  });
  it("ticking one of several open to dos is not", () => {
    const { onLastTick } = page(step({ todos: [{ id: "t1", title: "One", done: false }, { id: "t2", title: "Two", done: false }] }));
    click(document.body.querySelector('[aria-label="Mark Two done"]')!);
    expect(onLastTick).not.toHaveBeenCalled();
  });
  it("a client's turn leads with what we need from them, in its own box", () => {
    page(step({ notes: "<p>Reply OK, or tell us what to change.</p>" }), { describe: { label: "What we need from Brian", tone: "client" } });
    const box = document.body.querySelector('section[aria-label="What we need from Brian"]');
    expect(box?.textContent).toContain("Reply OK");
    expect(box?.className).toContain("bg-orange-50");
  });
  it("Claude's turn leads with what Claude should do", () => {
    page(step({ assigneeId: CLAUDE_ID, notes: "<p>Write 5 subject lines.</p>" }), { describe: { label: "What Claude should do", tone: "claude" } });
    expect(document.body.querySelector('section[aria-label="What Claude should do"]')?.className).toContain("bg-violet-50");
  });
  it("shows the step's thread, the last five, with the rest one click away", () => {
    const thread = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, who: i % 2 ? "Michaella" : "You to Michaella", text: `Message ${i}`, at: `2026-10-17T1${i}:00:00Z` }));
    page(step(), { thread });
    const box = document.body.querySelector('section[aria-label="Messages on this step"]')!;
    expect(box.querySelectorAll("li")).toHaveLength(5);
    expect(box.textContent).toContain("Message 6");
    expect(box.textContent).not.toContain("Message 1");
    click(Array.from(box.querySelectorAll("button")).find((b) => b.textContent === "Show earlier (2)")!);
    expect(box.querySelectorAll("li")).toHaveLength(7);
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
