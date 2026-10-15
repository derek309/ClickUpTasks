import { describe, it, expect, vi, afterEach } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// The "From (530) 362 0990 · ClickUpLocal Directory ▾" line over a text box:
// the number the conversation knows, every number in the menu grouped by
// account, another account's held back with why (Derek, 2026-10-15).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const accounts = [
  { locationId: "loc_agency", name: "ClickUpLocal", numbers: [{ number: "+15305550101", label: null, locationId: "loc_agency", locationName: "ClickUpLocal", isDefault: true }] },
  { locationId: "loc_directory", name: "ClickUpLocal Directory", numbers: [
    { number: "+15303620990", label: null, locationId: "loc_directory", locationName: "ClickUpLocal Directory", isDefault: true },
    { number: "+15303620991", label: "Derek's line", locationId: "loc_directory", locationName: "ClickUpLocal Directory", isDefault: false },
  ] },
];
vi.mock("@/lib/supabase", () => ({
  authedFetch: async () => Response.json({ accounts, numbers: accounts.flatMap((a) => a.numbers) }),
}));
const { FromNumberLine, fromPick, setFromPick } = await import("./FromNumber");

let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function mount(el: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null; host = null;
  setFromPick("thread:ghl:j", null);
});

const history = [{ channel: "sms", direction: "outbound", at: "2026-10-14T19:12:03Z", ourNumber: "+15303620991" }];

describe("FromNumberLine", () => {
  it("shows the number Jeannie knows, and every number by account in the menu", async () => {
    await mount(<FromNumberLine pickKey="thread:ghl:j" locationId="loc_directory" history={history} firstName="Jeannie" />);
    const trigger = host!.querySelector("button")!;
    expect(trigger.textContent).toBe("From (530) 362 0991 · ClickUpLocal Directory ▾");
    await act(async () => { trigger.click(); });
    const text = document.body.textContent ?? "";
    expect(text).toContain("ClickUpLocal Directory");
    expect(text).toContain("(530) 362 0990");
    expect(text).toContain("Derek's line · the one Jeannie knows");
    expect(text).toContain("Jeannie isn't in this account");
    expect(text).not.toMatch(/\d-\d/);
    const other = [...document.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")].find((b) => b.textContent?.includes("(530) 555 0101"))!;
    expect(other.disabled).toBe(true);
  });

  it("keeps a pick for the send, and says it isn't the number they know", async () => {
    await mount(<FromNumberLine pickKey="thread:ghl:j" locationId="loc_directory" history={history} firstName="Jeannie" />);
    await act(async () => { host!.querySelector("button")!.click(); });
    const pick = [...document.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")].find((b) => b.textContent?.includes("(530) 362 0990"))!;
    await act(async () => { pick.click(); });
    expect(fromPick("thread:ghl:j")).toBe("+15303620990");
    expect(host!.textContent).toContain("Not the number Jeannie knows");
  });
});
