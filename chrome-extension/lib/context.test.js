import { describe, it, expect } from "vitest";
import { normalizeUrl, isCapturable, isSignInUrl, layerContexts, prepareCapture, contextKey } from "./context.js";

describe("normalizeUrl", () => {
  it("ignores a trailing slash, the hash, and the query", () => {
    const base = normalizeUrl("https://app.gohighlevel.com/v2/location/abc");
    expect(normalizeUrl("https://app.gohighlevel.com/v2/location/abc/")).toBe(base);
    expect(normalizeUrl("https://app.gohighlevel.com/v2/location/abc#contacts")).toBe(base);
    expect(normalizeUrl("https://app.gohighlevel.com/v2/location/abc?tab=2")).toBe(base);
  });
  it("keeps genuinely different pages apart", () => {
    expect(normalizeUrl("https://x.com/a")).not.toBe(normalizeUrl("https://x.com/b"));
    expect(normalizeUrl("https://a.com/x")).not.toBe(normalizeUrl("https://b.com/x"));
  });
  it("does not collapse two different unparseable values together", () => {
    expect(normalizeUrl("not a url")).not.toBe(normalizeUrl("also not a url"));
  });
});

describe("isCapturable", () => {
  it("accepts http and https only", () => {
    expect(isCapturable("https://example.com")).toBe(true);
    expect(isCapturable("http://localhost:3000/")).toBe(true);
  });
  it("rejects what could never be reopened usefully", () => {
    for (const u of ["chrome://extensions", "chrome-extension://abc/page.html", "file:///Users/derek/x.pdf", "about:blank", "", null, undefined]) {
      expect(isCapturable(u)).toBe(false);
    }
  });
});

describe("isSignInUrl", () => {
  it("catches the usual ways a saved tab rots into a login page", () => {
    for (const u of [
      "https://accounts.google.com/signin/v2/identifier",
      "https://clientsite.com/wp-login.php",
      "https://app.example.com/login",
      "https://app.example.com/sign-in?x=1",
      "https://site.com/anything?redirect_to=%2Fwp-admin",
      "https://site.com/x?redirect_uri=https%3A%2F%2Fa.com",
    ]) {
      expect(isSignInUrl(u), u).toBe(true);
    }
  });
  it("leaves ordinary working pages alone", () => {
    for (const u of [
      "https://app.gohighlevel.com/v2/location/abc/contacts",
      "https://clientsite.com/wp-admin/edit.php",
      "https://www.figma.com/file/abc/Design",
      "https://blogin.example.com/posts",
    ]) {
      expect(isSignInUrl(u), u).toBe(false);
    }
  });
});

describe("layerContexts", () => {
  const baseline = [
    { url: "https://app.gohighlevel.com/v2/location/abc", title: "GHL" },
    { url: "https://clientsite.com/wp-admin/", title: "WP" },
  ];
  it("puts the client's tabs first, then the task's", () => {
    const out = layerContexts(baseline, [{ url: "https://figma.com/file/1", title: "Mockup" }]);
    expect(out.map((t) => t.title)).toEqual(["GHL", "WP", "Mockup"]);
  });
  it("does not open a page twice when the task repeats one of the client's", () => {
    const out = layerContexts(baseline, [{ url: "https://clientsite.com/wp-admin", title: "WP again" }]);
    expect(out).toHaveLength(2);
    expect(out[1].title).toBe("WP");
  });
  it("drops entries that could never be reopened", () => {
    const out = layerContexts([...baseline, { url: "chrome://extensions" }], []);
    expect(out).toHaveLength(2);
  });
  it("returns the client's own tabs when there is no task set", () => {
    expect(layerContexts(baseline)).toHaveLength(2);
    expect(layerContexts([], [])).toEqual([]);
  });
});

describe("prepareCapture", () => {
  it("keeps real pages ticked and pre-unticks sign-in pages", () => {
    const rows = prepareCapture([
      { url: "https://clientsite.com/wp-admin/", title: "WP" },
      { url: "https://accounts.google.com/signin", title: "Sign in" },
      { url: "chrome://extensions", title: "Extensions" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ keep: true, signIn: false });
    expect(rows[1]).toMatchObject({ keep: false, signIn: true });
  });
});

describe("contextKey", () => {
  it("keeps a client's baseline separate from each of its tasks", () => {
    expect(contextKey("cl_1", null)).not.toBe(contextKey("cl_1", "t_9"));
    expect(contextKey("cl_1", "t_9")).not.toBe(contextKey("cl_2", "t_9"));
    expect(contextKey("cl_1", undefined)).toBe(contextKey("cl_1", ""));
  });
});
