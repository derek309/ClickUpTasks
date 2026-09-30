import { describe, it, expect } from "vitest";
import { matchGhlToLocal, normalizeBody, isRealGhlId, type MatchCandidate } from "./ghlMatch";
import { ghlConfirmState, GHL_CONFIRM_SINCE } from "./data";

// The cases below are the shapes measured on live data (2026-09-30): Gmail's
// copy and GoHighLevel's synced copy of the same email.

const T = Date.parse("2026-10-01T17:00:00Z");
const local = (o: Partial<MatchCandidate> & { id: string }): MatchCandidate => ({
  channel: "email", direction: "outbound", body: "", subject: null, at: T, ...o,
});

describe("pairing a GoHighLevel message with the app's row", () => {
  it("pairs the same email a second apart", () => {
    const c = [local({ id: "m1", body: "<p>Hi Nicole, I hope you are having a great week.</p>", subject: "Next steps" })];
    expect(matchGhlToLocal({ channel: "email", direction: "outbound", body: "Hi Nicole, I hope you are having a great week.", subject: "Next steps", at: T + 1000 }, c)).toBe("m1");
  });

  it("reads through GoHighLevel's escaped entities", () => {
    const c = [local({ id: "m1", direction: "inbound", body: "From: Activ8 Commerce < support@activ8.com > sent the report" })];
    expect(matchGhlToLocal({ channel: "email", direction: "inbound", body: "From: Activ8 Commerce &lt; support@activ8.com &gt; sent the report", at: T - 18000 }, c)).toBe("m1");
  });

  it("falls back to the subject when the body came through as Outlook junk", () => {
    const c = [local({ id: "m1", body: "Hi Nicole, noting to do here.", subject: "Re: FW: Domain registration expires in 10 days" })];
    const ghl = { channel: "email", direction: "outbound", body: "v\\:* {behavior:url(#default#VML);} o\\:* {behavior:url(#default#VML);}", subject: "FW: Domain registration expires in 10 days", at: T + 7000 };
    expect(matchGhlToLocal(ghl, c)).toBe("m1");
  });

  it("does not cross two different emails from the same client seconds apart", () => {
    const c = [local({ id: "m1", direction: "inbound", body: "Hey Derek, it looks great! I sent it to Lu.", subject: "RE: Next steps on our plan" })];
    expect(matchGhlToLocal({ channel: "email", direction: "inbound", body: "Fixed. Is there anything I can fix up before showing?", subject: null, at: T + 16000 }, c)).toBeNull();
  });

  it("leaves a matching email more than two minutes out alone", () => {
    const c = [local({ id: "m1", subject: "Next steps for your website" })];
    expect(matchGhlToLocal({ channel: "email", direction: "outbound", body: "x", subject: "Next steps for your website", at: T + 381000 }, c)).toBeNull();
  });

  it("claims each local row once, nearest first", () => {
    const c = [local({ id: "far", subject: "Checking In", at: T - 40000 }), local({ id: "near", subject: "Checking In", at: T - 5000 })];
    const claimed = new Set<string>();
    const first = matchGhlToLocal({ channel: "email", direction: "outbound", body: "", subject: "Re: Checking In", at: T }, c, claimed);
    expect(first).toBe("near");
    claimed.add(first!);
    expect(matchGhlToLocal({ channel: "email", direction: "outbound", body: "", subject: "Checking In", at: T }, c, claimed)).toBe("far");
  });

  it("needs the same direction and channel", () => {
    const c = [local({ id: "m1", subject: "Hello" })];
    expect(matchGhlToLocal({ channel: "email", direction: "inbound", body: "", subject: "Hello", at: T }, c)).toBeNull();
    expect(matchGhlToLocal({ channel: "sms", direction: "outbound", body: "", subject: "Hello", at: T }, c)).toBeNull();
  });

  it("pairs two blank bodies only through a subject", () => {
    expect(matchGhlToLocal({ channel: "email", direction: "outbound", body: "", subject: "", at: T }, [local({ id: "m1" })])).toBeNull();
  });

  it("pairs a call on time alone", () => {
    const c = [local({ id: "m1", channel: "call", direction: "inbound", body: "Missed call" })];
    expect(matchGhlToLocal({ channel: "call", direction: "inbound", body: "Call", at: T + 30000 }, c)).toBe("m1");
  });

  it("normalises entities and tags", () => {
    expect(normalizeBody("<b>Tom &amp; Jerry</b>&nbsp; &quot;hi&quot; &#39;yo&#39;")).toBe("tom & jerry \"hi\" 'yo'");
  });

  it("does not count a synthetic webhook key as a GoHighLevel id", () => {
    expect(isRealGhlId("synthetic:abc:call:2026")).toBe(false);
    expect(isRealGhlId("GC9UjzAbCdEfGhIjKlMn")).toBe(true);
    expect(isRealGhlId(null)).toBe(false);
  });
});

describe("Not in GoHighLevel", () => {
  const since = Date.parse(GHL_CONFIRM_SINCE);
  const at = new Date(since + 24 * 3600e3).toISOString();
  const now = since + 24 * 3600e3;

  it("waits an hour before flagging", () => {
    expect(ghlConfirmState({ channel: "email", ghlMessageId: null, at }, now + 59 * 60e3)).toBe("pending");
    expect(ghlConfirmState({ channel: "email", ghlMessageId: null, at }, now + 61 * 60e3)).toBe("missing");
  });
  it("is confirmed by a real id, not a synthetic one", () => {
    expect(ghlConfirmState({ channel: "sms", ghlMessageId: "abcdefghij1234567890", at }, now + 2 * 3600e3)).toBe("confirmed");
    expect(ghlConfirmState({ channel: "call", ghlMessageId: "synthetic:x", at }, now + 2 * 3600e3)).toBe("missing");
  });
  it("ignores chat and anything before launch day", () => {
    expect(ghlConfirmState({ channel: "chat", ghlMessageId: null, at }, now + 2 * 3600e3)).toBeNull();
    expect(ghlConfirmState({ channel: "email", ghlMessageId: null, at: new Date(since - 1000).toISOString() }, now)).toBeNull();
  });
});
