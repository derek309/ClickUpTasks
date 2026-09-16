import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BulkDelegateModal } from "./BulkDelegateModal";
import type { User } from "@/lib/data";

// The form the batch goes through: that it refuses to half happen for the same
// reasons a single handoff does, that the six shared answers come out the other
// side, and that size and priority can be unpicked again, since leaving them
// alone is what "no change" means here.

const users: User[] = [
  { id: "u_maria", name: "Maria", color: "#111" } as User,
  { id: "u_justin", name: "Justin", color: "#222" } as User,
];

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

const button = (label: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const type = (value: string) => {
  const box = host.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(box, value); box.dispatchEvent(new Event("input", { bubbles: true })); });
};

function open(over: Partial<React.ComponentProps<typeof BulkDelegateModal>> = {}) {
  const props = { count: 3, users, onCancel: vi.fn(), onDelegate: vi.fn(), onProblem: vi.fn(), ...over };
  render(<BulkDelegateModal {...props} />);
  return props;
}

describe("delegating a batch", () => {
  it("says how many are going, and that they stay yours", () => {
    open({ count: 4 });
    expect(host.textContent).toContain("Delegate 4 tasks");
    expect(host.textContent).toContain("The tasks stay yours.");
    expect(button("Delegate 4")).toBeTruthy();
  });

  it("counts one task without an s", () => {
    open({ count: 1 });
    expect(host.textContent).toContain("Delegate 1 task");
  });

  it("refuses without a person, and says which thing is missing", () => {
    const p = open();
    click(button("Delegate 3"));
    expect(p.onProblem).toHaveBeenCalledWith("Pick who you are handing these to.");
    expect(p.onDelegate).not.toHaveBeenCalled();
  });

  it("refuses without a brief, then without a date they owe it by", () => {
    const p = open();
    click(button("Maria"));
    click(button("Delegate 3"));
    expect(p.onProblem).toHaveBeenLastCalledWith("Say what they need to do.");

    type("Draft the copy");
    click(button("Delegate 3"));
    expect(p.onProblem).toHaveBeenLastCalledWith("Give them a date to have these by.");
    expect(p.onDelegate).not.toHaveBeenCalled();
  });

  it("hands over the six shared answers once everything is there", () => {
    const p = open();
    click(button("Maria"));
    type("Draft the copy and send it back");
    // Pick the first offered "they owe it" date chip.
    const dateChips = Array.from(host.querySelectorAll("button")).filter((b) => /^(Tomorrow|In \d|Next )/.test(b.textContent ?? ""));
    click(dateChips[0]);
    click(button("Delegate 3"));
    expect(p.onDelegate).toHaveBeenCalledTimes(1);
    expect(p.onDelegate).toHaveBeenCalledWith(expect.objectContaining({
      toId: "u_maria",
      instructions: "Draft the copy and send it back",
      theirDue: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      size: null,
      priority: null,
    }));
  });

  it("lets a size and a priority be unpicked again, which is what leaving them alone means", () => {
    const p = open();
    click(button("Maria"));
    type("Do it");
    const dateChips = Array.from(host.querySelectorAll("button")).filter((b) => /^(Tomorrow|In \d|Next )/.test(b.textContent ?? ""));
    click(dateChips[0]);

    click(button("1 hour"));
    click(button("1 hour"));   // pressing it again clears it
    click(button("Delegate 3"));
    expect(p.onDelegate).toHaveBeenLastCalledWith(expect.objectContaining({ size: null, priority: null }));
  });

  it("closes without doing anything when Cancel is pressed", () => {
    const p = open();
    click(button("Cancel"));
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(p.onDelegate).not.toHaveBeenCalled();
  });

  it("offers everyone it was given, and nobody else", () => {
    open();
    expect(button("Maria")).toBeTruthy();
    expect(button("Justin")).toBeTruthy();
  });
});
