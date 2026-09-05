import { describe, it, expect } from "vitest";
import { normalizeEnriched } from "./normalize";

// The model is not trusted, so these are the rules that have to hold when it
// is wrong. Pure function, no network — see the comment on normalizeEnriched.
const TODAY = "2026-09-04";

describe("normalizeEnriched", () => {
  it("passes a well-formed answer through", () => {
    const r = normalizeEnriched(
      { title: "Send the artwork", description: "Due before the deadline.", priority: "urgent", due: "2026-09-10", followUpAt: "2026-09-08" },
      "Subject line", TODAY,
    );
    expect(r).toEqual({ title: "Send the artwork", description: "Due before the deadline.", priority: "urgent", due: "2026-09-10", followUpAt: "2026-09-08" });
  });

  describe("priority", () => {
    it("rejects a tier the model is not allowed to assign", () => {
      // client_request and conversation are assigned when the system sees a
      // real client interaction. A model handing them out forges that signal.
      expect(normalizeEnriched({ priority: "client_request" }, "s", TODAY).priority).toBe("normal");
      expect(normalizeEnriched({ priority: "conversation" }, "s", TODAY).priority).toBe("normal");
    });
    it("rejects something invented and falls back to normal", () => {
      expect(normalizeEnriched({ priority: "critical" }, "s", TODAY).priority).toBe("normal");
      expect(normalizeEnriched({ priority: 3 }, "s", TODAY).priority).toBe("normal");
      expect(normalizeEnriched({}, "s", TODAY).priority).toBe("normal");
    });
    it("keeps every tier it is allowed to use", () => {
      for (const p of ["none", "normal", "urgent"]) {
        expect(normalizeEnriched({ priority: p }, "s", TODAY).priority).toBe(p);
      }
    });
  });

  describe("dates", () => {
    it("drops anything that is not yyyy-mm-dd", () => {
      expect(normalizeEnriched({ due: "next Friday" }, "s", TODAY).due).toBeNull();
      expect(normalizeEnriched({ due: "09/10/2026" }, "s", TODAY).due).toBeNull();
      expect(normalizeEnriched({ followUpAt: 20260910 }, "s", TODAY).followUpAt).toBeNull();
    });
    it("pulls a past due date up to today", () => {
      expect(normalizeEnriched({ due: "2026-08-01" }, "s", TODAY).due).toBe(TODAY);
    });
    it("pulls a past follow-up up to today", () => {
      expect(normalizeEnriched({ followUpAt: "2026-08-01" }, "s", TODAY).followUpAt).toBe(TODAY);
    });
    it("never follows up after the work was promised", () => {
      const r = normalizeEnriched({ due: "2026-09-08", followUpAt: "2026-09-20" }, "s", TODAY);
      expect(r.followUpAt).toBe("2026-09-08");
    });
    // The reason due is clamped first: pinning the follow-up to a due date
    // that is itself still in the past drags the follow-up back with it.
    it("does not drag a follow-up into the past via a past due date", () => {
      const r = normalizeEnriched({ due: "2026-01-01", followUpAt: "2026-09-06" }, "s", TODAY);
      expect(r.due).toBe(TODAY);
      expect(r.followUpAt).toBe(TODAY);
      expect(r.followUpAt! >= TODAY).toBe(true);
    });
    it("leaves both null when the email said nothing", () => {
      const r = normalizeEnriched({ due: null, followUpAt: null }, "s", TODAY);
      expect(r.due).toBeNull();
      expect(r.followUpAt).toBeNull();
    });
  });

  describe("text", () => {
    it("falls back to the subject when there is no title", () => {
      expect(normalizeEnriched({ title: "   " }, "The subject", TODAY).title).toBe("The subject");
      expect(normalizeEnriched({}, "The subject", TODAY).title).toBe("The subject");
    });
    // Never the raw response: it is JSON now, and a blob of it in the Notes
    // field is worse than an empty one.
    it("falls back to an empty description, not to junk", () => {
      expect(normalizeEnriched({}, "s", TODAY).description).toBe("");
      expect(normalizeEnriched({ description: 42 }, "s", TODAY).description).toBe("");
    });
    it("caps runaway output", () => {
      const r = normalizeEnriched({ title: "x".repeat(500), description: "y".repeat(9000) }, "s", TODAY);
      expect(r.title.length).toBe(200);
      expect(r.description.length).toBe(4000);
    });
  });

  it("survives garbage in place of an object", () => {
    expect(normalizeEnriched(null, "Fallback", TODAY).title).toBe("Fallback");
    expect(normalizeEnriched("nope", "Fallback", TODAY).priority).toBe("normal");
  });
});
