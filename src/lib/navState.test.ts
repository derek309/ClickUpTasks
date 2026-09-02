import { describe, it, expect } from "vitest";
import { buildSearch, parseSearch, type NavState } from "./navState";

// The URL is the app's shareable state: paste a link and land where the sender
// was. Round-tripping is the property that matters — a link that does not
// survive build → parse → build sends someone somewhere else.
const base: NavState = {
  view: null, client: "all", project: null, task: null,
  clientTab: null, vaultFolder: null, dm: null,
};

describe("the deep-link URL", () => {
  it("is empty when there is nothing to say", () => {
    expect(buildSearch(base)).toBe("");
  });

  it("round-trips a client, its project and an open task", () => {
    const s: NavState = { ...base, client: "cl_1", project: "p_2", task: "t_3" };
    expect(parseSearch(buildSearch(s))).toMatchObject({ client: "cl_1", project: "p_2", task: "t_3" });
  });

  it("round-trips a view, and a DM inside the inbox", () => {
    expect(parseSearch(buildSearch({ ...base, view: "inbox", dm: "u_1" })))
      .toMatchObject({ view: "inbox", dm: "u_1" });
    expect(parseSearch(buildSearch({ ...base, view: "settings" }))).toMatchObject({ view: "settings" });
  });

  // A view and a client are mutually exclusive by construction: the special
  // boards are not scoped to one client, so encoding both would produce a link
  // that contradicts itself.
  it("drops the client when a view is set, rather than emitting both", () => {
    const out = buildSearch({ ...base, view: "clients", client: "cl_1" });
    expect(out).toContain("view=clients");
    expect(out).not.toContain("client=cl_1");
  });

  it("keeps the task across a view, because an open task is orthogonal to where you are", () => {
    expect(parseSearch(buildSearch({ ...base, view: "work", task: "t_9" })))
      .toMatchObject({ view: "work", task: "t_9" });
  });

  it("omits the default tab and keeps a non-default one", () => {
    expect(buildSearch({ ...base, client: "cl_1", clientTab: "tasks" })).not.toContain("tab=");
    expect(parseSearch(buildSearch({ ...base, client: "cl_1", clientTab: "chat" }))).toMatchObject({ clientTab: "chat" });
  });

  it("refuses a view it does not recognise instead of trusting the URL", () => {
    expect(parseSearch("?view=../../etc/passwd").view).toBeNull();
    expect(parseSearch("?view=admin").view).toBeNull();
  });

  it("defaults a missing client to all, not to undefined", () => {
    expect(parseSearch("").client).toBe("all");
  });
});
