import { describe, it, expect, vi, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useEscapeToClose } from "./useEscapeToClose";

// A dialog opened over the task drawer must take Escape for itself. The drawer
// closes on Escape from a document listener, so each case stands one of those
// up and checks who hears the key.

function Overlay({ onClose, active }: { onClose: () => void; active: boolean }) {
  useEscapeToClose(onClose, active);
  return null;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const drawer = vi.fn();

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
  document.removeEventListener("keydown", drawer);
  drawer.mockReset();
});

describe("useEscapeToClose", () => {
  it("closes the open overlay and keeps Escape from the drawer under it", () => {
    document.addEventListener("keydown", drawer);
    const close = vi.fn();
    mount(<Overlay onClose={close} active />);
    pressEscape();
    expect(close).toHaveBeenCalledTimes(1);
    expect(drawer).not.toHaveBeenCalled();
  });

  it("lets Escape reach the drawer while the overlay is not open", () => {
    document.addEventListener("keydown", drawer);
    const close = vi.fn();
    mount(<Overlay onClose={close} active={false} />);
    pressEscape();
    expect(close).not.toHaveBeenCalled();
    expect(drawer).toHaveBeenCalledTimes(1);
  });

  it("stops listening once the overlay is gone", () => {
    const close = vi.fn();
    mount(<Overlay onClose={close} active />);
    act(() => root!.unmount());
    root = null;
    pressEscape();
    expect(close).not.toHaveBeenCalled();
  });
});
