import { describe, it, expect } from "vitest";
import {
  stateToZone, postalToState, areaCodeToState, resolveTimeZone, validZone, zoneWord,
  meetingTimesCopy, dayTimesCopy, clocksDiffer, offsetMinutes,
} from "./meetingTimes";

// Mon, Oct 19 2026, 1:30 PM Pacific (daylight time) = 20:30 UTC.
const MON_130 = "2026-10-19T20:30:00.000Z";
const TUE_10 = "2026-10-20T17:00:00.000Z"; // Tue 10:00 AM Pacific
const MON_930PM = "2026-10-20T04:30:00.000Z"; // Mon 9:30 PM Pacific = Tue 12:30 AM Eastern

const DASHES = /[-–—]/;

describe("stateToZone", () => {
  it("reads codes and names written any way", () => {
    expect(stateToZone("CA")).toBe("America/Los_Angeles");
    expect(stateToZone("Ca")).toBe("America/Los_Angeles");
    expect(stateToZone("  New  Jersey ")).toBe("America/New_York");
    expect(stateToZone("N.J.")).toBe("America/New_York");
    expect(stateToZone("texas")).toBe("America/Chicago");
    expect(stateToZone("Arizona")).toBe("America/Phoenix");
    expect(stateToZone("HI")).toBe("Pacific/Honolulu");
    expect(stateToZone("Alaska")).toBe("America/Anchorage");
    expect(stateToZone("Washington DC")).toBe("America/New_York");
    expect(stateToZone("Ontario")).toBe("America/Toronto");
  });
  it("gives null for nothing or something unknown", () => {
    expect(stateToZone("")).toBeNull();
    expect(stateToZone(null)).toBeNull();
    expect(stateToZone("Bavaria")).toBeNull();
  });
});

describe("postalToState", () => {
  it("maps a ZIP's first three digits", () => {
    expect(postalToState("90210")).toBe("CA");
    expect(postalToState("10001")).toBe("NY");
    expect(postalToState("60614-1234")).toBe("IL");
    expect(postalToState("85001")).toBe("AZ");
    expect(postalToState("96813")).toBe("HI");
    expect(postalToState("99501")).toBe("AK");
    expect(postalToState("02108")).toBe("MA");
  });
  it("maps a Canadian postal code's first letter", () => {
    expect(postalToState("M5V 3L9")).toBe("ON");
    expect(postalToState("v6b1a1")).toBe("BC");
  });
  it("gives null for anything else", () => {
    expect(postalToState("")).toBeNull();
    expect(postalToState("SW1A 1AA")).toBeNull();
  });
});

describe("areaCodeToState", () => {
  it("reads +1 numbers written any way", () => {
    expect(areaCodeToState("+13125551234")).toBe("IL");
    expect(areaCodeToState("(212) 555-1234")).toBe("NY");
    expect(areaCodeToState("1 503 555 1234")).toBe("OR");
    expect(areaCodeToState("+1 416 555 1234")).toBe("ON");
  });
  it("skips numbers outside North America and junk", () => {
    expect(areaCodeToState("+442071234567")).toBeNull();
    expect(areaCodeToState("555")).toBeNull();
    expect(areaCodeToState(null)).toBeNull();
  });
});

describe("resolveTimeZone", () => {
  it("takes GoHighLevel's own timezone first", () => {
    expect(resolveTimeZone({ timeZone: "America/Denver", state: "NY", phone: "+13125551234" })).toEqual({ timeZone: "America/Denver", source: "ghl_timezone" });
  });
  it("then the state, then the ZIP, then the phone", () => {
    expect(resolveTimeZone({ timeZone: "", state: "Florida", postalCode: "90210" })).toEqual({ timeZone: "America/New_York", source: "state" });
    expect(resolveTimeZone({ state: "", postalCode: "75201", phone: "+12125551234" })).toEqual({ timeZone: "America/Chicago", source: "postal_code" });
    expect(resolveTimeZone({ phone: "+12065551234" })).toEqual({ timeZone: "America/Los_Angeles", source: "phone" });
  });
  it("keeps El Paso on Mountain time", () => {
    expect(resolveTimeZone({ postalCode: "79901" })?.timeZone).toBe("America/Denver");
    expect(resolveTimeZone({ phone: "+19155551234" })?.timeZone).toBe("America/Denver");
  });
  it("ignores a bad timezone and gives null when nothing says", () => {
    expect(resolveTimeZone({ timeZone: "Not/AZone", state: "WA" })?.source).toBe("state");
    expect(resolveTimeZone({})).toBeNull();
    expect(resolveTimeZone({ country: "GB", postalCode: "10115", phone: "+442071234567" })).toBeNull();
  });
  it("validZone pulls an IANA name out", () => {
    expect(validZone("America/Chicago")).toBe("America/Chicago");
    expect(validZone("GMT-06:00 America/Chicago (CST)")).toBe("America/Chicago");
    expect(validZone("")).toBeNull();
  });
});

describe("zoneWord", () => {
  it("says the plain words", () => {
    expect(zoneWord("America/Los_Angeles")).toBe("Pacific");
    expect(zoneWord("America/Denver")).toBe("Mountain");
    expect(zoneWord("America/Chicago")).toBe("Central");
    expect(zoneWord("America/New_York")).toBe("Eastern");
    expect(zoneWord("America/Phoenix")).toBe("Arizona");
    expect(zoneWord("America/Anchorage")).toBe("Alaska");
    expect(zoneWord("Pacific/Honolulu")).toBe("Hawaii");
    expect(zoneWord("America/Indiana/Knox")).toBe("Central");
  });
  it("else the city, with no dashes or underscores", () => {
    expect(zoneWord("Europe/London")).toBe("London");
    expect(zoneWord("Asia/Ho_Chi_Minh")).toBe("Ho Chi Minh");
    expect(zoneWord("America/Port-au-Prince")).toBe("Eastern");
  });
});

describe("meetingTimesCopy", () => {
  it("keeps today's wording in the same zone", () => {
    const c = meetingTimesCopy([MON_130, TUE_10], "America/Los_Angeles");
    expect(c.paired).toBe(false);
    expect(c.emailIntro).toBe("Here are a few times that work for me (Pacific):");
    expect(c.lines).toEqual(["Mon, Oct 19, 1:30 PM", "Tue, Oct 20, 10:00 AM"]);
    expect(c.smsSentence).toBe("I'm open Mon, Oct 19, 1:30 PM, or Tue, Oct 20, 10:00 AM (Pacific).");
    expect(c.aiTimes).toBe("Offered times (Pacific): Mon, Oct 19, 1:30 PM; Tue, Oct 20, 10:00 AM.");
  });
  it("keeps today's wording when their zone is unknown", () => {
    const c = meetingTimesCopy([MON_130], null);
    expect(c.paired).toBe(false);
    expect(c.lines).toEqual(["Mon, Oct 19, 1:30 PM"]);
  });
  it("gives my time and theirs in another zone", () => {
    const c = meetingTimesCopy([MON_130, TUE_10], "America/Chicago");
    expect(c.paired).toBe(true);
    expect(c.emailIntro).toBe("Here are a few times that work for me, in my time and yours:");
    expect(c.lines).toEqual([
      "Mon, Oct 19, 1:30 PM Pacific (3:30 PM Central, your time)",
      "Tue, Oct 20, 10:00 AM Pacific (12:00 PM Central, your time)",
    ]);
    expect(c.smsSentence).toBe("I'm open Mon, Oct 19, 1:30 PM Pacific (3:30 PM Central, your time), or Tue, Oct 20, 10:00 AM Pacific (12:00 PM Central, your time).");
    expect(c.aiTimes).toContain("Pacific time and the client's Central time");
    expect(c.aiTimes).toContain("3:30 PM Central");
  });
  it("names their weekday when the time falls on another day for them", () => {
    expect(meetingTimesCopy([MON_930PM], "America/New_York").lines).toEqual(["Mon, Oct 19, 9:30 PM Pacific (Tue 12:30 AM Eastern, your time)"]);
    // Earlier for them: Hawaii is a day behind just after midnight Pacific.
    expect(meetingTimesCopy(["2026-10-20T07:30:00.000Z"], "Pacific/Honolulu").lines).toEqual(["Tue, Oct 20, 12:30 AM Pacific (Mon 9:30 PM Hawaii, your time)"]);
  });
  it("compares offsets, not names, across daylight time", () => {
    // Arizona matches Pacific in summer, and is an hour ahead in winter.
    const july = "2026-07-13T20:30:00.000Z";
    const dec = "2026-12-07T21:30:00.000Z"; // Mon 1:30 PM Pacific standard time
    expect(meetingTimesCopy([july], "America/Phoenix").paired).toBe(false);
    expect(meetingTimesCopy([dec], "America/Phoenix").lines).toEqual(["Mon, Dec 7, 1:30 PM Pacific (2:30 PM Arizona, your time)"]);
    // London leaves daylight time a week before the US does (Oct 25 vs Nov 1, 2026).
    expect(offsetMinutes("Europe/London", Date.parse("2026-10-23T20:30:00Z")) - offsetMinutes("America/Los_Angeles", Date.parse("2026-10-23T20:30:00Z"))).toBe(480);
    expect(meetingTimesCopy(["2026-10-23T20:30:00.000Z", "2026-10-27T20:30:00.000Z"], "Europe/London").lines).toEqual([
      "Fri, Oct 23, 1:30 PM Pacific (9:30 PM London, your time)",
      "Tue, Oct 27, 1:30 PM Pacific (8:30 PM London, your time)",
    ]);
    // A week where only some times differ still pairs every one.
    expect(clocksDiffer(["2026-10-30T20:30:00.000Z", "2026-11-02T21:30:00.000Z"], "America/Phoenix")).toBe(true);
  });
  it("offers no times when there are none", () => {
    const c = meetingTimesCopy([], "America/Chicago");
    expect(c.lines).toEqual([]);
    expect(c.smsSentence).toBe("");
    expect(c.aiTimes).toBe("Offered times (Pacific): none, just the booking link.");
  });
  it("never writes a dash in the copy", () => {
    for (const tz of [null, "America/Chicago", "America/New_York", "Pacific/Honolulu", "America/Port-au-Prince"]) {
      const c = meetingTimesCopy([MON_130, MON_930PM], tz);
      for (const s of [c.emailIntro, c.smsSentence, ...c.lines]) expect(s).not.toMatch(DASHES);
      const d = dayTimesCopy([MON_130, MON_930PM], tz);
      expect(d.header).not.toMatch(DASHES);
      expect(d.time(MON_930PM)).not.toMatch(DASHES);
    }
  });
});

describe("dayTimesCopy", () => {
  it("is Pacific only in the same zone", () => {
    const d = dayTimesCopy([MON_130], "America/Los_Angeles");
    expect(d.header).toBe("here are my open times (Pacific):");
    expect(d.time(MON_130)).toBe("1:30 PM");
  });
  it("puts their time after each in another zone", () => {
    const d = dayTimesCopy([MON_130, MON_930PM], "America/New_York");
    expect(d.header).toBe("here are my open times in Pacific, with your Eastern time after each:");
    expect(d.time(MON_130)).toBe("1:30 PM (4:30 PM)");
    expect(d.time(MON_930PM)).toBe("9:30 PM (Tue 12:30 AM)");
  });
});
