import { describe, it, expect } from "vitest";
import { buildSearch, parseSearch, type NavState } from "./navState";

// The URL is the app's shareable state: paste a link and land where the sender
// was. Round-tripping is the property that matters — a link that does not
// survive build → parse → build sends someone somewhere else.
const base: NavState = {
  view: null, client: "all", project: null, task: null,
  clientTab: null, vaultFolder: null, dm: null, assignee: null, sub: null,
};

describe("the deep-link URL", () => {
  it("is empty when there is nothing to say", () => {
    expect(buildSearch(base)).toBe("");
  });

  // All Tasks with an assignee selected is the one case where "client: all"
  // still needs to say something — see currentNav's comment in Cockpit.tsx.
  it("round-trips an All Tasks assignee, but not the default", () => {
    expect(buildSearch({ ...base, assignee: "mine" })).toBe("");
    const s: NavState = { ...base, assignee: "u_michaella" };
    expect(parseSearch(buildSearch(s))).toMatchObject({ client: "all", assignee: "u_michaella" });
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

// Plan and the completed log used to be clicks and nothing else: neither could
// be linked or bookmarked, and the completed log had no way in but landing on
// All Tasks and pressing its button.
describe("the second half of a view", () => {
  it("carries My Work's Plan tab, and only there", () => {
    expect(buildSearch({ ...base, view: "work", sub: "plan" })).toBe("?view=work&sub=plan");
    expect(parseSearch("?view=work&sub=plan").sub).toBe("plan");
    // Work is the default half, so it stays off the URL.
    expect(buildSearch({ ...base, view: "work", sub: null })).toBe("?view=work");
    // Nowhere else has a Plan.
    expect(buildSearch({ ...base, view: "clients", sub: "plan" })).toBe("?view=clients");
  });

  it("carries the completed log on All Tasks, whoever it is scoped to", () => {
    expect(buildSearch({ ...base, sub: "completed" })).toBe("?sub=completed");
    expect(buildSearch({ ...base, assignee: "u_maria", sub: "completed" })).toBe("?assignee=u_maria&sub=completed");
    expect(parseSearch("?assignee=u_maria&sub=completed")).toMatchObject({ assignee: "u_maria", sub: "completed" });
    // Not on a client's own list, which has no completed log of its own.
    expect(buildSearch({ ...base, client: "c_1", sub: "completed" })).toBe("?client=c_1");
  });

  it("ignores a value it does not know, rather than guessing", () => {
    expect(parseSearch("?view=work&sub=nonsense").sub).toBe(null);
    expect(parseSearch("").sub).toBe(null);
  });

  it("round trips both halves through a link", () => {
    for (const s of [
      { ...base, view: "work" as const, sub: "plan" as const },
      { ...base, sub: "completed" as const },
      { ...base, assignee: "all", sub: "completed" as const },
      { ...base, view: "work" as const, sub: "plan" as const, task: "t_9" },
    ]) {
      expect(buildSearch(parseSearch(buildSearch(s)))).toBe(buildSearch(s));
    }
  });
});
