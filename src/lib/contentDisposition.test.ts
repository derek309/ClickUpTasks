// @vitest-environment node
import { describe, it, expect } from "vitest";
import { contentDisposition } from "./contentDisposition";

describe("contentDisposition", () => {
  it("survives a Mac screenshot name (a narrow no-break space before PM)", () => {
    const name = "Screenshot 2026-09-20 at 6.34.24 PM.png";
    const h = contentDisposition("inline", name);
    // The thing that broke: a header value has to be plain characters.
    expect(() => new Headers({ "Content-Disposition": h })).not.toThrow();
    expect(h).toContain('filename="Screenshot 2026-09-20 at 6.34.24 PM.png"');
    expect(decodeURIComponent(h.split("filename*=UTF-8''")[1])).toBe(name);
  });

  it("keeps accents in the real name and drops them only from the fallback", () => {
    const h = contentDisposition("attachment", "Café menu.pdf");
    expect(() => new Headers({ "Content-Disposition": h })).not.toThrow();
    expect(h).toContain('filename="Cafe menu.pdf"');
    expect(h).toContain("filename*=UTF-8''Caf%C3%A9%20menu.pdf");
  });

  it("cannot be broken out of by quotes or new lines", () => {
    const h = contentDisposition("attachment", 'a"b\r\nSet-Cookie: x.png');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.startsWith('attachment; filename="abSet-Cookie: x.png"')).toBe(true);
  });
});
