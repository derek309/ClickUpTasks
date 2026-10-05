import { describe, it, expect, vi, afterEach } from "vitest";
import { shortcut, modKey } from "./platform";

const as = (platform: string) => vi.stubGlobal("navigator", { platform, userAgent: "" });
afterEach(() => vi.unstubAllGlobals());

describe("shortcut keys as the computer writes them", () => {
  it("Mac", () => { as("MacIntel"); expect(shortcut("K")).toBe("⌘K"); expect(modKey()).toBe("⌘"); });
  it("Windows", () => { as("Win32"); expect(shortcut("K")).toBe("Ctrl+K"); expect(shortcut("Enter")).toBe("Ctrl+Enter"); expect(modKey()).toBe("Ctrl"); });
});
