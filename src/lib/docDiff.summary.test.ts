import { describe, it, expect } from "vitest";
import { summarizeDocChanges } from "./docDiff";

describe("summarizeDocChanges", () => {
  it("lists the wording added and removed", () => {
    const summary = summarizeDocChanges("<p>Order by Friday for fall races.</p>", "<p>Order by Monday for fall races and Turkey Trots.</p>");
    expect(summary).toContain("Added:");
    expect(summary).toContain("Monday");
    expect(summary).toContain("Turkey Trots");
    expect(summary).toContain("Removed:");
    expect(summary).toContain("Friday");
  });

  it("is null when only the formatting changed", () => {
    expect(summarizeDocChanges("<p>Same words</p>", "<p><strong>Same</strong> words</p>")).toBeNull();
  });

  it("caps a long summary", () => {
    const summary = summarizeDocChanges("<p>a</p>", `<p>a ${"word ".repeat(1000)}</p>`, 200);
    expect(summary!.length).toBeLessThanOrEqual(201);
    expect(summary!.endsWith("…")).toBe(true);
  });
});
