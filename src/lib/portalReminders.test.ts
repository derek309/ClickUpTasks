import { describe, it, expect } from "vitest";
import { isReminderHour, reminderEmail, reminderGroups } from "./portalReminders";

describe("client reminder timing", () => {
  it("is 8 AM California on a weekday only, summer and winter", () => {
    expect(isReminderHour(Date.parse("2026-10-05T15:00:00Z"))).toBe(true); // Mon 8 AM PDT
    expect(isReminderHour(Date.parse("2026-10-05T16:00:00Z"))).toBe(false); // Mon 9 AM PDT
    expect(isReminderHour(Date.parse("2026-11-30T16:00:00Z"))).toBe(true); // Mon 8 AM PST
    expect(isReminderHour(Date.parse("2026-12-02T16:00:00Z"))).toBe(true); // Wed 8 AM PST
    expect(isReminderHour(Date.parse("2026-10-06T15:00:00Z"))).toBe(true); // Tue 8 AM PDT
    expect(isReminderHour(Date.parse("2026-10-09T15:00:00Z"))).toBe(true); // Fri 8 AM PDT
    expect(isReminderHour(Date.parse("2026-10-10T15:00:00Z"))).toBe(false); // Saturday
    expect(isReminderHour(Date.parse("2026-10-11T15:00:00Z"))).toBe(false); // Sunday
  });
});

describe("the reminder's words (Remind and the 8 AM job share them)", () => {
  const link = { url: "https://x/waiting/abc", label: "Open your client portal" };
  it("gives the count, never the items, sends them to the portal and asks them not to reply", () => {
    const e = reminderEmail({ firstName: "James", groups: [{ name: "Website", count: 18 }], link })!;
    expect(e.subject).toBe("We need 18 things from you to move forward");
    expect(e.body).toMatch(/Hi James,/);
    expect(e.body).toMatch(/We can't move forward until we get 18 things from you\./);
    expect(e.body).not.toMatch(/<ul>/); // one list needs no breakdown
    expect(e.body).toMatch(/https:\/\/x\/waiting\/abc/);
    expect(e.body).toMatch(/Open your client portal/);
    expect(e.body).toMatch(/Please use the portal rather than replying to this email/);
    expect(e.aiContext).toMatch(/never the items themselves/);
  });
  it("counts per list when there are several, and says thing for one", () => {
    const e = reminderEmail({ firstName: null, groups: [{ name: "Website", count: 2 }, { name: "Ads & <Social>", count: 1 }], link })!;
    expect(e.subject).toBe("We need 3 things from you to move forward");
    expect(e.body).toMatch(/Hi there,/);
    expect(e.body).toMatch(/until we get 3 things from you:<\/p><ul>/);
    expect(e.body).toMatch(/Website: 2/);
    expect(e.body).toMatch(/Ads &amp; &lt;Social&gt;: 1/);
    expect(reminderEmail({ firstName: "A", groups: [{ name: "X", count: 1 }], link })!.subject).toBe("We need 1 thing from you to move forward");
  });
  it("is nothing when nothing is waiting", () => {
    expect(reminderEmail({ firstName: "A", groups: [], link })).toBeNull();
  });
  it("groups by list in the client's list order, with Other last", () => {
    const lists = [{ id: "p2", name: "Website" }, { id: "p1", name: "Ads" }, { id: "p3", name: "Empty" }];
    const waiting = [{ projectId: "p2" }, { projectId: "p1" }, { projectId: "p2" }, { projectId: null }, { projectId: "gone" }];
    expect(reminderGroups(waiting, lists)).toEqual([{ name: "Ads", count: 1 }, { name: "Website", count: 2 }, { name: "Other", count: 2 }]);
  });
});
