import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClientRequestsList } from "./ClientRequestsList";
import type { FoldInRow } from "./FoldInSheet";

// The fold in from "What we need from James": the line, the sheet's asks and
// dates, unticking one, and the one dark button's count.

let root: Root | null = null;
let host: HTMLDivElement;
function render(ui: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  document.body.innerHTML = "";
  root = null;
});
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

const rows: FoldInRow[] = [
  { taskId: "t1", title: "Send the static Facebook ad with the reviewer's changes", listId: "p1", notes: null },
  { taskId: "t2", title: "Add the PlanEnroll self enrollment option", listId: "p1", notes: "FOLLOW UP: Tue.\n\nBlocked on: James's own PlanEnroll link." },
  { taskId: "t3", title: "Other absolute claims to clear with James", listId: "p2", notes: null },
];

function open(onFoldIn = vi.fn(async () => {})) {
  render(<ClientRequestsList clientId="cl_x" first="James" requests={[]} today="2026-10-15" asked={{}} listName={(id) => (id === "p1" ? "Ads" : "Website")}
    foldIn={rows} onFoldIn={onFoldIn} onOpenStep={() => {}} onReorder={() => {}} onClose={() => {}} />);
  return onFoldIn;
}

describe("fold in", () => {
  it("says how many are waiting on him but not in the list", () => {
    open();
    expect(document.body.textContent).toContain("3 older tasks are waiting on James but aren't in this list.");
    expect(document.body.textContent).not.toContain("Nothing is waiting on James");
  });
  it("Add them opens the sheet with the asks and fresh dates, and adds the ticked ones", async () => {
    const onFoldIn = open();
    click(button("Add them")!);
    const boxes = Array.from(document.querySelectorAll("textarea")).map((t) => t.value);
    expect(boxes).toEqual(["Send the static Facebook ad with the reviewer's changes", "Send your own PlanEnroll link", "Clear the other absolute claims"]);
    expect(document.body.textContent).toContain("Need by Tue, Oct 20");
    expect(document.body.textContent).toContain("Need by Thu, Oct 22");
    expect(document.body.textContent).toContain("Need by Mon, Oct 26");
    // Untick the second: the third moves up to its date.
    click(document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1]);
    expect(document.body.textContent).toContain("Left out");
    expect(document.body.textContent).not.toContain("Need by Mon, Oct 26");
    await act(async () => { button("Add 2 to James's list")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onFoldIn).toHaveBeenCalledTimes(1);
    expect((onFoldIn.mock.calls[0] as unknown[])[0]).toEqual([
      { taskId: "t1", ask: "Send the static Facebook ad with the reviewer's changes", needBy: "2026-10-20" },
      { taskId: "t3", ask: "Clear the other absolute claims", needBy: "2026-10-22" },
    ]);
  });
});
