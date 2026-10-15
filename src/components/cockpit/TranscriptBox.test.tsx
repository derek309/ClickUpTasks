import { describe, it, expect, vi, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TranscriptBox } from "./TranscriptBox";

// Add the transcript: closed with nothing in it, nothing is saved; pasted
// text saves with the recording link; Escape closes only the box.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
const q = <T extends Element>(sel: string) => host!.querySelector(sel) as T;
const button = (label: string) => Array.from(host!.querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement;
function type(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("TranscriptBox", () => {
  it("says why it opened, with a box to paste into", () => {
    mount(<TranscriptBox reason="Granola didn't find this meeting. Paste it or drop the file." onSave={() => {}} onCancel={() => {}} />);
    expect(host!.textContent).toContain("Add the transcript");
    expect(host!.textContent).toContain("Granola didn't find this meeting.");
    expect(q<HTMLTextAreaElement>('textarea[aria-label="Paste the transcript"]')).toBeTruthy();
    expect(button("Choose a file")).toBeTruthy();
  });

  it("closed empty saves nothing", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    mount(<TranscriptBox reason="x" onSave={onSave} onCancel={onCancel} />);
    expect(button("Save transcript").disabled).toBe(true);
    act(() => { button("Save transcript").click(); });
    act(() => { button("Cancel").click(); });
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels the box only", () => {
    const onCancel = vi.fn();
    mount(<TranscriptBox reason="x" onSave={() => {}} onCancel={onCancel} />);
    act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("saves what was pasted, as pasted, with the recording link", () => {
    const onSave = vi.fn();
    mount(<TranscriptBox reason="x" onSave={onSave} onCancel={() => {}} />);
    type(q<HTMLTextAreaElement>("textarea"), "Derek: Hi\nPam: Hello ");
    type(q<HTMLInputElement>('input[aria-label="Recording link"]'), "zoom.us/rec/1");
    expect(button("Save transcript").disabled).toBe(false);
    act(() => { button("Save transcript").click(); });
    expect(onSave).toHaveBeenCalledWith({ text: "Derek: Hi\nPam: Hello ", file: null, link: "zoom.us/rec/1" });
  });

  it("takes a dropped transcript file, and says no to another kind", () => {
    const onSave = vi.fn();
    mount(<TranscriptBox reason="x" onSave={onSave} onCancel={() => {}} />);
    const input = q<HTMLInputElement>('input[type="file"]');
    const bad = new File(["x"], "clip.mp4", { type: "video/mp4" });
    Object.defineProperty(input, "files", { configurable: true, value: [bad] });
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host!.textContent).toContain("That isn't a transcript file.");
    const good = new File(["WEBVTT"], "call.vtt", { type: "text/vtt" });
    Object.defineProperty(input, "files", { configurable: true, value: [good] });
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host!.textContent).toContain("call.vtt");
    act(() => { button("Save transcript").click(); });
    expect(onSave).toHaveBeenCalledWith({ text: "", file: good, link: "" });
  });

  it("offers waiting for Granola only when it can still come", () => {
    const onWait = vi.fn();
    mount(<TranscriptBox reason="x" onSave={() => {}} onCancel={() => {}} onWait={onWait} />);
    act(() => { button("Wait for Granola").click(); });
    expect(onWait).toHaveBeenCalledTimes(1);
  });
});
