import { describe, it, expect, vi, afterEach } from "vitest";
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useEscapeToClose } from "./useEscapeToClose";

// Escape closes the thing on top and nothing under it. Every overlay in the app
// registers through this hook — the drawer, a review window over it, a dialog
// opened from that — so these stand several up at once and check who hears the
// key, and that a field handling Escape itself still wins.

function Overlay({ onClose, active = true }: { onClose: () => void; active?: boolean }) {
  useEscapeToClose(onClose, active);
  return null;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(el: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}
const pressEscape = () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("useEscapeToClose", () => {
  it("closes the overlay that opened last, not the one under it", () => {
    const drawer = vi.fn();
    const dialog = vi.fn();
    mount(<><Overlay onClose={drawer} /><Overlay onClose={dialog} /></>);
    pressEscape();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(drawer).not.toHaveBeenCalled();
  });

  it("closes one layer per press, from the top down", () => {
    const drawer = vi.fn();
    const window_ = vi.fn();
    const preview = vi.fn();
    function Stack() {
      const [depth, setDepth] = useState(3);
      return (
        <>
          <Overlay onClose={() => { drawer(); setDepth(0); }} active={depth >= 1} />
          <Overlay onClose={() => { window_(); setDepth(1); }} active={depth >= 2} />
          <Overlay onClose={() => { preview(); setDepth(2); }} active={depth >= 3} />
        </>
      );
    }
    mount(<Stack />);
    act(() => { pressEscape(); });
    expect([preview, window_, drawer].map((f) => f.mock.calls.length)).toEqual([1, 0, 0]);
    act(() => { pressEscape(); });
    expect([preview, window_, drawer].map((f) => f.mock.calls.length)).toEqual([1, 1, 0]);
    act(() => { pressEscape(); });
    expect([preview, window_, drawer].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("an overlay that is not open takes nothing, and the one under it closes", () => {
    const drawer = vi.fn();
    const dialog = vi.fn();
    mount(<><Overlay onClose={drawer} /><Overlay onClose={dialog} active={false} /></>);
    pressEscape();
    expect(dialog).not.toHaveBeenCalled();
    expect(drawer).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape alone when a field has already handled it", () => {
    const drawer = vi.fn();
    mount(<Overlay onClose={drawer} />);
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.addEventListener("keydown", (e) => e.stopPropagation());
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(drawer).not.toHaveBeenCalled();
    field.remove();
  });

  it("stops listening once every overlay is gone", () => {
    const close = vi.fn();
    mount(<Overlay onClose={close} />);
    act(() => root!.unmount());
    root = null;
    pressEscape();
    expect(close).not.toHaveBeenCalled();
  });
});
