import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AiEmailBox } from "./AiEmailBox";
import { AiAskBox } from "./AiAskBox";
import { WhatsNext } from "./WhatsNext";
import type { AiAsk3, AiEmailSuggest, AiNext } from "@/lib/aiSteps";
import type { ReceivedEmail, Subtask } from "@/lib/data";

// AI in steps on the step's page, with the AI mocked (Derek, 2026-10-17).

let root: Root | null = null;
let host: HTMLDivElement;
function render(ui: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
}
const rerender = (ui: React.ReactElement) => act(() => root!.render(ui));
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; });
const buttons = (label: string) => Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === label);
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const type = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

const email: ReceivedEmail = { messageId: "m1", from: "Chelsea Proctor", subject: "Re: Hot Chocolate assets", at: "2026-10-16T18:28:00Z", body: "Here are the items I still need.\nNovember header BY ASAP\nJanuary banner BY FRIDAY, DECEMBER 4" };
const suggest = (p: Partial<AiEmailSuggest> = {}): AiEmailSuggest => ({
  messageId: "m1", at: "2026-10-17T00:00:00Z", asks: true, name: "Hot Chocolate email headers for Chelsea", description: "Chelsea needs Hot Chocolate creative.",
  items: [{ title: "November header", when: null, whenLabel: "ASAP", description: "", parts: [] }, { title: "January banner", when: "2026-12-04", whenLabel: "Dec 4", description: "", parts: [] }],
  who: "u_mich", due: "2026-10-21", why: "she designs the headers", ownWork: false, list: "Hot Chocolate 2026/27", ...p,
});
const choices = [{ key: "u_derek", label: "You" }, { key: "u_mich", label: "Michaella" }, { key: "client", label: "Brian" }];

function box(step: Subtask, p: Partial<React.ComponentProps<typeof AiEmailBox>> = {}) {
  const props = { step, email, sender: "Chelsea", clientFirst: "Brian", choices, turnWord: (k: string | null) => (k === "u_mich" ? "Michaella's turn" : "Your turn"), nameOf: (k: string | null) => (k === "u_mich" ? "Michaella" : "you"),
    read: vi.fn(async () => suggest()), onCache: vi.fn(), onUse: vi.fn(), onSplit: vi.fn(), ...p };
  render(<AiEmailBox {...props} />);
  return props;
}
const step = (p: Partial<Subtask> = {}): Subtask => ({ id: "s1", title: "Reply to Chelsea", done: false, fromEmails: [email], ...p } as Subtask);

describe("✨ Claude read it", () => {
  it("reads the email once, when the page opens, and keeps it on the step", async () => {
    const p = box(step());
    expect(host.textContent).toContain("Claude is reading it");
    await flush();
    expect(p.read).toHaveBeenCalledTimes(1);
    expect(p.onCache).toHaveBeenCalledWith(suggest());
    // Kept: drawn again with it on the step, it does not ask again.
    rerender(<AiEmailBox {...p} step={step({ aiSuggest: suggest() })} />);
    await flush();
    expect(p.read).toHaveBeenCalledTimes(1);
  });
  it("an email read before is not read again", async () => {
    const p = box(step({ aiSuggest: suggest() }));
    await flush();
    expect(p.read).not.toHaveBeenCalled();
  });
  it("a plain thanks gets nothing", async () => {
    const p = box(step(), { email: { ...email, body: "Thanks!" } });
    await flush();
    expect(p.read).not.toHaveBeenCalled();
    expect(host.textContent).toBe("");
  });
  it("different dates: the split is the default; Keep it as one step uses this", async () => {
    const p = box(step({ aiSuggest: suggest() }));
    expect(host.textContent).toContain("Chelsea asked for 2 things with different dates");
    expect(buttons("Make 2 tasks")).toHaveLength(1);
    click(buttons("Make 2 tasks")[0]);
    expect(p.onSplit).toHaveBeenCalledTimes(1);
    click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Keep it as one step"))!);
    click(buttons("Use this")[0]);
    expect(p.onUse).toHaveBeenCalledWith(suggest());
  });
  it("one date: the step, with its checklist and suggested turn, and Use this", () => {
    const one = suggest({ items: [{ title: "November header", when: null, whenLabel: "ASAP", description: "", parts: [] }] });
    const p = box(step({ aiSuggest: one }));
    const text = host.textContent ?? "";
    expect(text).toContain("Claude read it. Here's the step:");
    expect(text).toContain("November header");
    expect(text).toContain("Suggested turn: Michaella's turn, due Wed, Oct 21 (she designs the headers).");
    click(buttons("Use this")[0]);
    expect(p.onUse).toHaveBeenCalledTimes(1);
  });
  it("Change it edits before saving, and the edit is what is used", () => {
    const one = suggest({ items: [{ title: "November header", when: null, whenLabel: "ASAP", description: "", parts: [] }] });
    const p = box(step({ aiSuggest: one }));
    click(buttons("Change it")[0]);
    type(host.querySelector('input[aria-label="Item 1"]') as HTMLInputElement, "November header, 960 x 960");
    click(buttons("Use this")[0]);
    expect((p.onUse as ReturnType<typeof vi.fn>).mock.calls[0][0].items[0].title).toBe("November header, 960 x 960");
  });
  it("No thanks hides it for this email", () => {
    const p = box(step({ aiSuggest: suggest() }));
    click(buttons("No thanks")[0]);
    expect(p.onCache).toHaveBeenCalledWith({ ...suggest(), dismissed: true });
    rerender(<AiEmailBox {...p} step={step({ aiSuggest: { ...suggest(), dismissed: true } })} />);
    expect(host.textContent).toBe("");
  });
  it("once made, the step links to the tasks made from this email", () => {
    const onOpenTask = vi.fn();
    box(step({ aiSuggest: { ...suggest(), made: [{ id: "t1", title: "November header" }] } }), { onOpenTask });
    expect(host.textContent).toContain("Made from this email");
    click(buttons("November header")[0]);
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });
  it("AI in steps off: nothing shows", async () => {
    box(step(), { read: vi.fn(async () => "off" as const) });
    await flush();
    expect(host.textContent).toBe("");
  });
});

describe("What's next comes filled in", () => {
  const wnChoices = [{ key: "u_derek", label: "You" }, { key: "client", label: "Brian" }];
  const ai: AiNext = { name: "Send the newsletter to Brian to approve", who: "client", due: "2026-10-21", why: "Brian approves every newsletter first" };
  function form(p: Partial<React.ComponentProps<typeof WhatsNext>> = {}) {
    const onSave = vi.fn();
    render(<WhatsNext done="✓ Hand off · done by Michaella" suggestion="Check in with Brian" who="u_derek" due="2026-10-18" choices={wnChoices} meId="u_derek" clientFirst="Brian" nameOf={() => "Someone"}
      today="2026-10-17" onSave={onSave} onCloseTask={vi.fn()} {...p} />);
    return { onSave };
  }
  const nameBox = () => host.querySelector('input[aria-label="The next step"]') as HTMLInputElement;
  it("the rule's suggestion shows at once, then Claude's fills the name and the turn line, with why", async () => {
    let answer: (n: AiNext) => void = () => {};
    const askAi = vi.fn(() => new Promise<AiNext | null>((r) => { answer = r; }));
    const onAi = vi.fn();
    const { onSave } = form({ askAi, onAi });
    expect(nameBox().placeholder).toBe("Check in with Brian");
    expect(nameBox().value).toBe("");
    await act(async () => { answer(ai); await Promise.resolve(); });
    expect(nameBox().value).toBe(ai.name);
    expect(host.textContent).toContain("Brian's turn");
    expect(host.textContent).toContain("✨ Why: Brian approves every newsletter first");
    expect(onAi).toHaveBeenCalledWith(ai);
    click(buttons("Write Brian's email")[0]);
    expect(onSave).toHaveBeenCalledWith({ name: ai.name, who: "client", due: "2026-10-21", waits: false });
  });
  it("what was typed before Claude answered wins", async () => {
    let answer: (n: AiNext) => void = () => {};
    form({ askAi: () => new Promise((r) => { answer = r; }) });
    type(nameBox(), "Call Brian");
    await act(async () => { answer(ai); await Promise.resolve(); });
    expect(nameBox().value).toBe("Call Brian");
    expect(host.textContent).not.toContain("✨ Why");
  });
  it("kept from before, it does not ask again", () => {
    const askAi = vi.fn(async () => ai);
    form({ ai, askAi });
    expect(askAi).not.toHaveBeenCalled();
    expect(nameBox().value).toBe(ai.name);
  });
  it("a failure says nothing and leaves the rule's suggestion", async () => {
    form({ askAi: async () => null });
    await flush();
    expect(nameBox().value).toBe("");
    expect(nameBox().placeholder).toBe("Check in with Brian");
  });
});

describe("✨ Write it for me", () => {
  const ask: AiAsk3 = { need: "Your logo as a PNG by Friday, Oct 23. Just reply to this email with it.", subject: "Your logo", body: "Hi Brian,\nWe need your logo.", at: "x" };
  const client = (p: Partial<Subtask> = {}): Subtask => ({ id: "c1", title: "Ask Brian: logo", done: false, ...p } as Subtask);
  it("an empty client step offers it on its own, as a suggestion, without filling anything", async () => {
    const read = vi.fn(async () => ask);
    const onCache = vi.fn();
    const onFill = vi.fn();
    render(<AiAskBox step={client()} first="Brian" emailWritten={false} read={read} onCache={onCache} onFill={onFill} />);
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(onCache).toHaveBeenCalledWith(ask);
    expect(onFill).not.toHaveBeenCalled();
    rerender(<AiAskBox step={client({ aiAsk: ask })} first="Brian" emailWritten={false} read={read} onCache={onCache} onFill={onFill} />);
    expect(host.textContent).toContain("What we need from Brian");
    click(buttons("Use this")[0]);
    expect(onFill).toHaveBeenCalledWith(ask);
  });
  it("a step with a description has the button, which fills the fields when pressed", async () => {
    const read = vi.fn(async () => ask);
    const onFill = vi.fn();
    render(<AiAskBox step={client({ notes: "<p>Logo</p>" })} first="Brian" emailWritten={false} read={read} onCache={vi.fn()} onFill={onFill} />);
    await flush();
    expect(read).not.toHaveBeenCalled();
    click(buttons("✨ Write it for me")[0]);
    await flush();
    expect(onFill).toHaveBeenCalledWith(ask);
  });
});
