import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NewStepBox } from "./NewStepBox";
import { CLAUDE_ID } from "@/lib/data";

// The new step box (Derek, 2026-10-17): the name, the Checklist open, + Add ▾
// (Description first), the turn sentence, and the button by whose turn.

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
});
const buttons = (label: string) => Array.from(document.body.querySelectorAll("button")).filter((b) => b.textContent?.trim() === label);
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const fill = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const key = (el: Element, k: string, o: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...o })); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

const TODAY = "2026-10-17";
// The caller holds the name, as the task's + Add step row does.
function Held(p: { onSave: (...a: unknown[]) => void; whoInitial?: string | null }) {
  const [title, setTitle] = React.useState("");
  return <NewStepBox title={title} onTitle={setTitle} choices={[{ key: "u_derek", label: "You" }, { key: "u_mic", label: "Michaella" }, { key: CLAUDE_ID, label: "Claude" }, { key: "client", label: "Brian" }]}
    whoInitial={p.whoInitial ?? "u_derek"} whenInitial="2026-10-19" today={TODAY} meId="u_derek" clientFirst="Brian" nameOf={(id) => (id === "u_mic" ? "Michaella" : "Someone")}
    actions={[{ key: "doc", label: "Document", onPick: vi.fn() }]} onSave={p.onSave} />;
}
function open(whoInitial?: string | null) {
  const onSave = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Held onSave={onSave} whoInitial={whoInitial} />));
  return onSave;
}

describe("NewStepBox", () => {
  it("opens with the name and one to do, the Description behind + Add, and no button rows", () => {
    open();
    expect(host.querySelector("input[aria-label='Step name']")?.getAttribute("placeholder")).toBe("Name the step");
    expect(host.querySelector("input[aria-label='To do 1']")?.getAttribute("placeholder")).toBe("Add a to do");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).not.toContain("Whose turn?");
    expect(host.textContent).not.toContain("By when?");
    expect(host.textContent).not.toContain("What's the action?");
    expect(host.textContent).toContain("Your turn");
  });

  it("saves the title, description, to dos, whose turn and due", async () => {
    const onSave = open();
    fill(host.querySelector<HTMLInputElement>("input[aria-label='Step name']")!, "Make the flyer");
    click(buttons("Add ▾")[0]);
    click(buttons("Description")[0]);
    fill(host.querySelector("textarea")!, "For the open house.");
    fill(host.querySelector<HTMLInputElement>("input[aria-label='To do 1']")!, "Pick the photo");
    key(host.querySelector("input[aria-label='To do 1']")!, "Enter");
    await flush();
    fill(host.querySelector<HTMLInputElement>("input[aria-label='To do 2']")!, "Write the caption");
    click(buttons("Add step")[0]);
    expect(onSave).toHaveBeenCalledWith({ title: "Make the flyer", description: "For the open house.", todos: ["Pick the photo", "Write the caption"], who: "u_derek", when: "2026-10-19", action: null }, undefined);
  });

  it("Enter in the name moves to the first to do; Cmd+Enter saves", async () => {
    const onSave = open();
    const name = host.querySelector<HTMLInputElement>("input[aria-label='Step name']")!;
    fill(name, "Call Amanda");
    key(name, "Enter");
    await flush();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("To do 1");
    expect(onSave).not.toHaveBeenCalled();
    key(document.activeElement!, "Enter", { metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("the button follows whose turn", () => {
    open("u_mic");
    expect(buttons("Give to Michaella")).toHaveLength(1);
    act(() => root!.unmount()); root = null; host.remove();
    open(CLAUDE_ID);
    expect(buttons("Give to Claude")).toHaveLength(1);
    expect(host.textContent).toContain("Claude's turn, today");
    act(() => root!.unmount()); root = null; host.remove();
    open("client");
    expect(buttons("Write Brian's email")).toHaveLength(1);
    expect(host.textContent).toContain("Brian's turn, need by");
  });

  it("Claude's turn saves for today", () => {
    const onSave = open(CLAUDE_ID);
    click(buttons("Give to Claude")[0]);
    expect(onSave.mock.calls[0][0]).toMatchObject({ who: CLAUDE_ID, when: TODAY });
  });

  it("something from + Add is held and run on save", () => {
    const onSave = open();
    fill(host.querySelector<HTMLInputElement>("input[aria-label='Step name']")!, "Flyer");
    click(buttons("Add ▾")[0]);
    click(buttons("Document")[0]);
    expect(host.textContent).toContain("Using");
    click(buttons("Add step")[0]);
    expect(onSave.mock.calls[0][0]).toMatchObject({ action: "doc" });
    expect(onSave.mock.calls[0][1]).toEqual(expect.any(Function));
  });

  it("needs a name first while it is your turn", () => {
    open();
    expect((buttons("Add step")[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
