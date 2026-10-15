import { describe, it, expect, vi, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useUndoActions } from "./useUndoActions";
import { useEscapeToClose } from "./useEscapeToClose";
import { DraftMessageBox } from "./DraftMessageBox";
import { StepSetup } from "./StepSetup";
import { answerWhatsNext, type Subtask } from "@/lib/data";
import type { ActionState } from "@/lib/undoAction";

// Esc on an action with nothing entered takes it back, and does not also
// close the task under it (Derek, 2026-10-15).

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(el: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});
const pressEscape = () => act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

const asking: Subtask = { id: "s3", title: "Send the proposal: what's next?", done: false, addedFor: "next:s1" };

// A drawer in small: its own Escape, the task in a ref, an action noted.
function harness() {
  const ref: { current: ActionState } = { current: { subtasks: [asking], draftEmail: null } };
  const closeDrawer = vi.fn();
  const undone = vi.fn();
  let api: ReturnType<typeof useUndoActions> | null = null;
  function Drawer() {
    useEscapeToClose(closeDrawer);
    api = useUndoActions({ taskId: "t1", task: ref.current, current: () => ref.current, apply: (p) => { ref.current = { ...ref.current, ...p }; }, onUndone: undone });
    return null;
  }
  mount(<Drawer />);
  const pickText = () => act(() => {
    const before = ref.current;
    ref.current = { ...ref.current, subtasks: answerWhatsNext(ref.current.subtasks, "s3", "Text Carol", { draftMessage: { channel: "sms", body: "" } }) };
    api!.note("msg:s3", before);
  });
  return { ref, closeDrawer, undone, pickText, api: () => api! };
}

describe("useUndoActions", () => {
  it("Escape takes back a text pick with nothing written, and the task stays open", () => {
    const h = harness();
    h.pickText();
    expect(h.ref.current.subtasks[0].title).toBe("Text Carol");
    pressEscape();
    expect(h.ref.current.subtasks[0].title).toBe("Send the proposal: what's next?");
    expect(h.ref.current.subtasks[0].draftMessage).toBeUndefined();
    expect(h.undone).toHaveBeenCalledTimes(1);
    expect(h.closeDrawer).not.toHaveBeenCalled();
    // Nothing waits any more: the next Escape closes the task.
    pressEscape();
    expect(h.closeDrawer).toHaveBeenCalledTimes(1);
  });

  it("once something was written, Escape keeps it and goes on to close the task", () => {
    const h = harness();
    h.pickText();
    h.ref.current = { ...h.ref.current, subtasks: h.ref.current.subtasks.map((s) => ({ ...s, draftMessage: { channel: "sms" as const, body: "Hi Carol" } })) };
    pressEscape();
    expect(h.ref.current.subtasks[0].draftMessage?.body).toBe("Hi Carol");
    expect(h.undone).not.toHaveBeenCalled();
    expect(h.closeDrawer).toHaveBeenCalledTimes(1);
  });

  it("leaving the email window takes back with the window's own copy of the draft", () => {
    const h = harness();
    act(() => {
      const before = h.ref.current;
      h.ref.current = { ...h.ref.current, draftEmail: { subject: "Hi", body: "<p>Hi Carol,</p>", createdAt: "2026-10-15T10:00:00Z", replyTo: null } };
      h.api().note("email", before);
    });
    // Typing the window holds and has not saved yet keeps it.
    expect(h.api().leave("email", { draftEmail: { ...h.ref.current.draftEmail!, body: "<p>Hi Carol, the roof is done.</p>" } })).toBe(false);
    expect(h.ref.current.draftEmail).not.toBeNull();
  });

  it("closing with nothing entered takes the email back", () => {
    const h = harness();
    act(() => {
      const before = h.ref.current;
      h.ref.current = { ...h.ref.current, draftEmail: { subject: "Hi", body: "<p>Hi Carol,</p>", createdAt: "2026-10-15T10:00:00Z", replyTo: null } };
      h.api().note("email", before);
    });
    expect(h.api().leave("email", { draftEmail: h.ref.current.draftEmail })).toBe(true);
    expect(h.ref.current.draftEmail).toBeNull();
  });
});

describe("DraftMessageBox", () => {
  it("clicking away with nothing written tells the drawer", async () => {
    const onLeave = vi.fn();
    const onSave = vi.fn();
    mount(<><DraftMessageBox channel="sms" body="" firstName="Carol" onSave={onSave} onSend={() => {}} onDiscard={() => {}} onLeave={onLeave} /><button id="away">x</button></>);
    const box = host!.querySelector("textarea")!;
    act(() => { box.focus(); });
    act(() => { (host!.querySelector("#away") as HTMLButtonElement).focus(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
  it("Escape after typing saves what was typed before the key goes on", () => {
    const onSave = vi.fn();
    mount(<DraftMessageBox channel="sms" body="" firstName="Carol" onSave={onSave} onSend={() => {}} onDiscard={() => {}} onLeave={() => {}} />);
    const box = host!.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Hi Carol");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onSave).toHaveBeenCalledWith("Hi Carol");
  });
});

describe("StepSetup's Escape on a step just made", () => {
  const props = { who: [{ key: "u_me", label: "You" }], whoInitial: "u_me", whenInitial: "2026-10-15", today: "2026-10-14", meId: "u_me", rows: [], skip: true };
  const escapeIn = () => act(() => { host!.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  it("cancels it instead of skipping when nothing was picked", () => {
    const onDone = vi.fn();
    const onEscape = vi.fn(() => true);
    mount(<StepSetup {...props} onDone={onDone} onEscape={onEscape} />);
    escapeIn();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
  it("skips as before when there is nothing to cancel", () => {
    const onDone = vi.fn();
    mount(<StepSetup {...props} onDone={onDone} onEscape={() => false} />);
    escapeIn();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
