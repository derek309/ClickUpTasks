import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MindDumpModal } from "./MindDumpModal";

// The composer's whole contract after 2026-09-28: four ways in, and the two on
// the left touch nothing. The test that matters most is the negative one, that
// adding a task as typed never calls either AI handler.

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

const button = (label: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim().includes(label))!;
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const type = (value: string) => {
  const box = host.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(box, value); box.dispatchEvent(new Event("input", { bubbles: true })); });
};
const press = (key: string, shiftKey = false) => {
  const box = host.querySelector("textarea")!;
  act(() => { box.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true })); });
};

function open(over: Partial<React.ComponentProps<typeof MindDumpModal>> = {}) {
  const props = {
    clientName: "Brian Goodell", listName: "Tasks", suggestedDue: null, busy: false,
    onParse: vi.fn().mockResolvedValue(null),
    onAiAdd: vi.fn().mockResolvedValue(null),
    onCreate: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  render(<MindDumpModal {...props} />);
  return props as typeof props & {
    onCreate: ReturnType<typeof vi.fn>; onAiAdd: ReturnType<typeof vi.fn>; onParse: ReturnType<typeof vi.fn>;
  };
}

describe("adding a task as typed", () => {
  it("creates it with the words as they were typed, and asks no model anything", () => {
    const p = open();
    type("Contact GoDaddy support to disconnect the associated product");
    click(button("Add as typed"));
    expect(p.onCreate).toHaveBeenCalledTimes(1);
    const [rows] = p.onCreate.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Contact GoDaddy support to disconnect the associated product");
    // The point of the whole path.
    expect(p.onAiAdd).not.toHaveBeenCalled();
    expect(p.onParse).not.toHaveBeenCalled();
  });

  it("does the same on Enter", () => {
    const p = open();
    type("Call Amanda back");
    press("Enter");
    expect(p.onCreate).toHaveBeenCalledTimes(1);
    expect(p.onCreate.mock.calls[0][0][0].title).toBe("Call Amanda back");
  });

  it("leaves Shift and Enter to the textarea", () => {
    const p = open();
    type("Call Amanda back");
    press("Enter", true);
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  // Paste twenty lines, hit Enter out of habit, and one task of the lot would
  // be the wrong answer.
  it("stops answering Enter once the text is more than one line", () => {
    const p = open();
    type("Book the venue\nSend the deposit");
    press("Enter");
    expect(p.onCreate).not.toHaveBeenCalled();
  });

  it("creates nothing from an empty box", () => {
    const p = open();
    click(button("Add as typed"));
    expect(p.onCreate).not.toHaveBeenCalled();
  });
});

describe("a pasted list, one per line", () => {
  it("shows the rows to review rather than creating them, and asks no model", () => {
    const p = open();
    type("Book the venue\nSend the deposit\nChase the contract");
    click(button("One per line"));
    expect(p.onCreate).not.toHaveBeenCalled();
    expect(p.onParse).not.toHaveBeenCalled();
    expect(host.textContent).toContain("3 tasks found");
    const titles = Array.from(host.querySelectorAll("input")).map((i) => i.value);
    expect(titles).toContain("Book the venue");
    expect(titles).toContain("Chase the contract");
  });
});

describe("the two AI ways", () => {
  it("Ask AI goes to the single task handler and nowhere else", () => {
    const p = open();
    type("call brian re the newsletter");
    click(button("Ask AI"));
    expect(p.onAiAdd).toHaveBeenCalledTimes(1);
    expect(p.onParse).not.toHaveBeenCalled();
  });

  it("Ask AI to split goes to the parser", () => {
    const p = open();
    type("call brian, then send the deposit");
    click(button("Ask AI to split"));
    expect(p.onParse).toHaveBeenCalledTimes(1);
    expect(p.onAiAdd).not.toHaveBeenCalled();
  });
});

describe("when there is no client on screen", () => {
  it("refuses every route until one is picked", () => {
    open({ needsClient: true, clients: [{ id: "cl_1", name: "Brian Goodell" }] });
    type("Something to do");
    for (const label of ["Add as typed", "Ask AI", "One per line", "Ask AI to split"]) {
      expect((button(label) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("lets them through once it has one", () => {
    open({ needsClient: true, defaultClientId: "cl_1", clients: [{ id: "cl_1", name: "Brian Goodell" }] });
    type("Something to do");
    expect((button("Add as typed") as HTMLButtonElement).disabled).toBe(false);
  });
});
