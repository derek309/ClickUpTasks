import { describe, expect, it } from "vitest";
import { decodeEntities } from "./data";

describe("decodeEntities", () => {
  it("turns a WordPress subject back into plain text", () => {
    expect(decodeEntities("New business submission: J&amp;J Screen &amp; Print")).toBe("New business submission: J&J Screen & Print");
    expect(decodeEntities("Joe&#039;s &quot;best&quot; &lt;3")).toBe(`Joe's "best" <3`);
  });
  it("decodes only once, so a literal &amp;amp; stays readable", () => {
    expect(decodeEntities("&amp;amp;")).toBe("&amp;");
  });
});
