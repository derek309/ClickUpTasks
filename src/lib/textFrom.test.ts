import { describe, it, expect } from "vitest";
import { checkFromNumber, defaultFromNumber, formatPhone, fromNumberNotes, ghlTextPayload, lastUsedNumber, ourNumberOnGhlMessage, phoneKey, resolveFromNumber, type TextNumber } from "./textFrom";

// Which of our numbers a text goes from (Derek, 2026-10-15: Jeannie asked
// "Are you texting me from another number?").

const AGENCY = "loc_agency", DIRECTORY = "loc_directory";
const numbers: TextNumber[] = [
  { number: "+15305550101", label: null, locationId: AGENCY, locationName: "ClickUpLocal", isDefault: true },
  { number: "+15305550102", label: "Derek's line", locationId: AGENCY, locationName: "ClickUpLocal", isDefault: false },
  { number: "+15303620990", label: null, locationId: DIRECTORY, locationName: "ClickUpLocal Directory", isDefault: true },
  { number: "+15303620991", label: null, locationId: DIRECTORY, locationName: "ClickUpLocal Directory", isDefault: false },
];
const text = (direction: "inbound" | "outbound", at: string, ourNumber: string | null, channel = "sms") => ({ channel, direction, at, ourNumber });

describe("formatPhone", () => {
  it("reads a US number with no dashes", () => {
    expect(formatPhone("+15303620990")).toBe("(530) 362 0990");
    expect(formatPhone("530-362-0990")).toBe("(530) 362 0990");
    expect(formatPhone("15303620990")).toBe("(530) 362 0990");
  });
  it("leaves anything else as given, dashes turned to spaces", () => {
    expect(formatPhone("+44 20-7946-0958")).toBe("+44 20 7946 0958");
    expect(formatPhone("")).toBe("");
    expect(formatPhone(null)).toBe("");
  });
  it("compares numbers by their last ten digits", () => {
    expect(phoneKey("+1 (530) 362-0990")).toBe(phoneKey("5303620990"));
  });
});

describe("the default number", () => {
  it("is the number we last texted them from", () => {
    const history = [
      text("outbound", "2026-10-01T10:00:00Z", "+15303620990"),
      text("outbound", "2026-10-14T10:00:00Z", "+15303620991"),
      text("inbound", "2026-10-13T10:00:00Z", null),
    ];
    expect(defaultFromNumber({ numbers, locationId: DIRECTORY, history })?.number).toBe("+15303620991");
  });

  it("is the number they last texted in to, when that is newer", () => {
    const history = [
      text("outbound", "2026-10-01T10:00:00Z", "+15303620990"),
      text("inbound", "2026-10-15T09:00:00Z", "+15303620991"),
    ];
    expect(defaultFromNumber({ numbers, locationId: DIRECTORY, history })?.number).toBe("+15303620991");
  });

  it("is the account's default with nothing known", () => {
    expect(defaultFromNumber({ numbers, locationId: DIRECTORY, history: [text("outbound", "2026-10-01T10:00:00Z", null)] })?.number).toBe("+15303620990");
    expect(defaultFromNumber({ numbers, locationId: AGENCY, history: [] })?.number).toBe("+15305550101");
  });

  it("never picks a number from another account", () => {
    const history = [text("outbound", "2026-10-14T10:00:00Z", "+15305550102")];
    expect(lastUsedNumber(history, numbers.filter((n) => n.locationId === DIRECTORY))).toBeNull();
    expect(defaultFromNumber({ numbers, locationId: DIRECTORY, history })?.number).toBe("+15303620990");
  });

  it("counts a missed call answered by text, not emails", () => {
    const history = [
      text("outbound", "2026-10-14T10:00:00Z", "+15303620991", "call"),
      text("outbound", "2026-10-15T10:00:00Z", "+15303620990", "email"),
    ];
    expect(lastUsedNumber(history)).toBe("+15303620991");
  });

  it("with the account unknown, only a number the conversation used", () => {
    expect(defaultFromNumber({ numbers, locationId: null, history: [] })).toBeNull();
    expect(defaultFromNumber({ numbers, locationId: null, history: [text("outbound", "2026-10-14T10:00:00Z", "5303620991")] })?.number).toBe("+15303620991");
  });

  it("is nothing when the numbers could not be read", () => {
    expect(defaultFromNumber({ numbers: [], locationId: DIRECTORY, history: [text("outbound", "2026-10-14T10:00:00Z", "+15303620991")] })).toBeNull();
  });
});

describe("a picked number", () => {
  it("is used when it is in their account", () => {
    const r = resolveFromNumber({ requested: "(530) 362 0991", locationId: DIRECTORY, numbers, history: [] });
    expect(r).toEqual({ ok: true, number: numbers[3] });
  });
  it("is refused from another account, saying which", () => {
    const r = checkFromNumber("+15305550101", DIRECTORY, numbers);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("ClickUpLocal");
    expect(!r.ok && r.error).not.toMatch(/-/);
  });
  it("is refused when it is not ours", () => {
    expect(checkFromNumber("+19165550000", DIRECTORY, numbers).ok).toBe(false);
  });
  it("none picked falls back to the default rule", () => {
    const r = resolveFromNumber({ requested: null, locationId: DIRECTORY, numbers, history: [text("inbound", "2026-10-15T09:00:00Z", "+15303620991")] });
    expect(r).toEqual({ ok: true, number: numbers[3] });
  });
});

describe("the send payload", () => {
  it("carries fromNumber when there is one", () => {
    expect(ghlTextPayload({ contactId: "c1", message: "Hi", fromNumber: "+15303620990", userId: "u1" }))
      .toEqual({ type: "SMS", contactId: "c1", message: "Hi", fromNumber: "+15303620990", userId: "u1" });
  });
  it("leaves it out when none is known, as before", () => {
    expect(ghlTextPayload({ contactId: "c1", message: "Hi", fromNumber: null, attachments: [] })).toEqual({ type: "SMS", contactId: "c1", message: "Hi" });
  });
});

describe("the from line on our sent texts", () => {
  it("says the number and marks a change from the text before", () => {
    const notes = fromNumberNotes([
      { id: "a", direction: "outbound", channel: "sms", ourNumber: "+15303620990" },
      { id: "b", direction: "inbound", channel: "sms", ourNumber: "+15303620990" },
      { id: "c", direction: "outbound", channel: "sms", ourNumber: null },
      { id: "d", direction: "outbound", channel: "sms", ourNumber: "+15303620990" },
      { id: "e", direction: "outbound", channel: "sms", ourNumber: "+15303620991" },
    ]);
    expect(notes.get("a")).toEqual({ number: "+15303620990", changed: false });
    expect(notes.has("b")).toBe(false);
    expect(notes.has("c")).toBe(false);
    expect(notes.get("d")?.changed).toBe(false);
    expect(notes.get("e")).toEqual({ number: "+15303620991", changed: true });
  });
});

describe("our number on a GoHighLevel message", () => {
  it("is where ours came from, or where theirs came in to", () => {
    expect(ourNumberOnGhlMessage({ direction: "outbound", from: "+15303620990", to: "+19165550000" })).toBe("+15303620990");
    expect(ourNumberOnGhlMessage({ direction: "inbound", from: "+19165550000", to: "+15303620991" })).toBe("+15303620991");
  });
  it("is nothing when GoHighLevel doesn't say", () => {
    expect(ourNumberOnGhlMessage({ direction: "outbound", body: "Hi" })).toBeNull();
    expect(ourNumberOnGhlMessage({ direction: "outbound", from: "Derek" })).toBeNull();
  });
});
