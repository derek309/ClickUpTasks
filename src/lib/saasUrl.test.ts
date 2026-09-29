import { describe, expect, it } from "vitest";
import { normalizeSaasUrl } from "./saasUrl";

describe("normalizeSaasUrl", () => {
  it("makes a bare address a working link and leaves the rest alone", () => {
    expect(normalizeSaasUrl(" acme.com ")).toBe("https://acme.com");
    expect(normalizeSaasUrl("http://acme.com")).toBe("http://acme.com");
    expect(normalizeSaasUrl("HTTPS://acme.com/app")).toBe("HTTPS://acme.com/app");
    expect(normalizeSaasUrl("  ")).toBe("");
  });
});
