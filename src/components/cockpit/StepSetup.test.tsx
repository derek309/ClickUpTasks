import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StepSetup, WhatsNextPicks, type SetupAction } from "./StepSetup";
import { CLAUDE_ID } from "@/lib/data";

// The action row is a find box and three recommended actions; the full list
// waits behind All actions or a typed letter (Derek, 2026-10-14).

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

const a = (key: string, label: string): SetupAction => ({ key, label, onPick: vi.fn() });
const WED = "2026-10-14";
function setup(p: Partial<React.ComponentProps<typeof StepSetup>> = {}) {
  const onDone = vi.fn();
  render(<StepSetup who={[{ key: "u_me", label: "You" }, { key: CLAUDE_ID, label: "Claude" }]} whoInitial="u_me" whenInitial="2026-10-15" today={WED} meId="u_me"
    rows={[{ label: "Write", items: [a("directions", "Description"), a("checklist", "To dos")] }, { label: "Make to review", items: [a("doc", "Document"), a("image", "Image"), a("page", "HTML review")] }]}
    onDone={onDone} {...p} />);
  return onDone;
}

describe("StepSetup's action row", () => {
  it("is one row, each action once, no find box and no All actions", () => {
    setup({ lead: [{ ...a("image", "Make the flyer") }] });
    expect(buttons("Make the flyer").length).toBeGreaterThan(0);
    expect(buttons("Description").length).toBeGreaterThan(0);
    expect(buttons("HTML review").length).toBeGreaterThan(0);
    expect(buttons("All actions")).toHaveLength(0);
    expect(host.querySelector("input[name=find-action]")).toBeNull();
  });
  it("puts four in the row and the rest in More", () => {
    setup({ rows: [{ label: "Write", items: [a("directions", "Description"), a("checklist", "To dos")] }, { label: "Make to review", items: [a("doc", "Document"), a("image", "Image"), a("page", "HTML review"), a("video", "Video")] }] });
    expect(buttons("Video")).toHaveLength(0);
    click(buttons("More ▾")[0]);
    expect(host.textContent).toContain("Video");
  });
  it("never offers Give to Claude as an action while Claude is in Whose turn", () => {
    setup({ rows: [{ label: "Write", items: [a("directions", "Description")] }] });
    expect(buttons("Give to Claude")).toHaveLength(0);
  });
  it("Claude's turn asks only what Claude should do: no date, Directions or To dos, Give to Claude", () => {
    const onDone = setup({ submit: "Save next step" });
    click(buttons("Claude")[0]);
    expect(host.textContent).not.toContain("By when?");
    expect(host.textContent).toContain("Tell Claude what to do");
    expect(buttons("Document")).toHaveLength(0);
    expect(host.querySelector("input[name=find-action]")).toBeNull();
    click(buttons("Give to Claude")[0]);
    expect(onDone).toHaveBeenCalledWith({ who: CLAUDE_ID, when: WED });
  });
  it("Claude then Directions hands it over with the directions to write", () => {
    const onDone = setup({ submit: "Save next step" });
    click(buttons("Claude")[0]);
    click(buttons("Description")[0]);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ who: CLAUDE_ID, when: WED }), expect.any(Function));
  });
  it("Add step sets it up with what is picked", () => {
    const onDone = setup({ submit: "Add step" });
    click(buttons("Add step")[0]);
    expect(onDone).toHaveBeenCalledWith({ who: "u_me", when: "2026-10-15" });
  });
  it("no Add step unless asked for", () => {
    setup();
    expect(buttons("Add step")).toHaveLength(0);
  });
  it("a whole request as the name says where it goes", () => {
    const long = "Please put the spring sale in the bulk customers blast and make sure the coupon code works on the landing page before Friday";
    setup({ stepName: long, longHint: true });
    expect(host.textContent).toContain("The full request goes into the step's description");
    act(() => root!.unmount()); root = null; host.remove();
    setup({ stepName: "Make the flyer", longHint: true });
    expect(host.textContent).not.toContain("The full request goes");
  });
});

describe("What's next picks", () => {
  it("three, the rest behind All actions, the task finished as a link", () => {
    const pick = (key: string, label: string) => ({ key, label, says: `${label} says`, onClick: vi.fn() });
    const finish = pick("finish", "The task is finished");
    render(<WhatsNextPicks picks={[pick("s", "Put it in the blast"), pick("doc", "Write a document"), pick("claude", "Give it to Claude")]}
      rest={[pick("fm", "Finish and email Brian")]} finish={finish} />);
    expect(host.textContent).not.toContain("Finish and email Brian");
    expect(buttons("Put it in the blast")[0].className).toContain("bg-accent");
    expect(buttons("Write a document")[0].getAttribute("title")).toBe("Write a document says");
    click(buttons("All actions")[0]);
    expect(host.textContent).toContain("Finish and email Brian");
    click(buttons("The task is finished")[0]);
    expect(finish.onClick).toHaveBeenCalled();
  });
});
