import { describe, it, expect } from "vitest";
import type { Message } from "@/lib/data";
import { buildThreads, inFolder, matchesSearch, dayGroup, snoozeUntil, type InboxState } from "./inboxModel";

const msg = (o: Partial<Message>): Message => ({
  id: o.id ?? Math.random().toString(36), contactId: "", clientId: "", channel: "email", direction: "inbound",
  subject: null, body: "", ghlMessageId: null, createdBy: null, at: "2026-10-01T17:00:00Z", read: false,
  attachments: [], cc: [], bcc: [], ...o,
});
const st = (o: Partial<InboxState> & { threadKey: string }): InboxState => ({ readAt: null, snoozedUntil: null, doneAt: null, updatedAt: null, ...o });
const NOW = new Date("2026-10-01T18:00:00Z").getTime();
const none = () => false;

describe("Inbox conversations", () => {
  const pam = [
    msg({ id: "a", gmailThreadId: "t1", subject: "Booking page photos", body: "Here are the headshots", peerName: "Pam Macias", at: "2026-10-01T17:12:00Z", attachments: [{ id: "x", name: "headshot-1.jpg", kind: "image", size: "" }] }),
    msg({ id: "b", gmailThreadId: "t1", direction: "outbound", body: "Need photos", at: "2026-09-30T16:00:00Z" }),
  ];
  const text = [msg({ id: "c", channel: "sms", ghlConversationId: "cv", body: "Add Elm St tonight?", at: "2026-10-01T16:48:00Z" })];

  it("groups a thread, newest first, and says who it is from", () => {
    const [t1, t2] = buildThreads([...pam, ...text], new Map(), { now: NOW });
    expect(t1.key).toBe("gm:t1");
    expect(t1.count).toBe(2);
    expect(t1.peerName).toBe("Pam Macias");
    expect(t1.subject).toBe("Booking page photos");
    expect(t1.hasFiles).toBe(true);
    expect(t1.unread).toBe(true);
    expect(t2.key).toBe("ghl:cv");
  });

  it("is read once opened, until they write again", () => {
    const s = new Map([["gm:t1", st({ threadKey: "gm:t1", readAt: "2026-10-01T17:30:00Z" })]]);
    expect(buildThreads(pam, s, { now: NOW })[0].unread).toBe(false);
    const later = [...pam, msg({ id: "d", gmailThreadId: "t1", at: "2026-10-01T17:45:00Z" })];
    expect(buildThreads(later, s, { now: NOW })[0].unread).toBe(true);
  });

  it("comes back from Done and from Snoozed when they write again", () => {
    const done = new Map([["gm:t1", st({ threadKey: "gm:t1", doneAt: "2026-10-01T17:20:00Z" })]]);
    expect(inFolder(buildThreads(pam, done, { now: NOW })[0], "inbox", none)).toBe(false);
    expect(inFolder(buildThreads(pam, done, { now: NOW })[0], "done", none)).toBe(true);
    const back = [...pam, msg({ id: "e", gmailThreadId: "t1", at: "2026-10-01T17:50:00Z" })];
    expect(inFolder(buildThreads(back, done, { now: NOW })[0], "inbox", none)).toBe(true);

    const snz = new Map([["gm:t1", st({ threadKey: "gm:t1", snoozedUntil: "2026-10-02T16:00:00Z", updatedAt: "2026-10-01T17:20:00Z" })]]);
    expect(inFolder(buildThreads(pam, snz, { now: NOW })[0], "snoozed", none)).toBe(true);
    expect(inFolder(buildThreads(back, snz, { now: NOW })[0], "inbox", none)).toBe(true);
    // The snooze ran out.
    expect(inFolder(buildThreads(pam, snz, { now: new Date("2026-10-02T17:00:00Z").getTime() })[0], "inbox", none)).toBe(true);
  });

  it("files by channel, and Sent is where you wrote last", () => {
    const [, t2] = buildThreads([...pam, ...text], new Map(), { now: NOW });
    expect(inFolder(t2, "sms", none)).toBe(true);
    expect(inFolder(t2, "email", none)).toBe(false);
    const fb = buildThreads([msg({ channel: "fb", ghlConversationId: "f" })], new Map(), { now: NOW })[0];
    expect(inFolder(fb, "social", none)).toBe(true);
    const sent = buildThreads([msg({ direction: "outbound", gmailThreadId: "s" })], new Map(), { now: NOW })[0];
    expect(inFolder(sent, "sent", none)).toBe(true);
  });

  it("searches people, words and file names", () => {
    const t = buildThreads(pam, new Map(), { now: NOW })[0];
    expect(matchesSearch(t, "headshot")).toBe(true);
    expect(matchesSearch(t, "pam photos")).toBe(true);
    expect(matchesSearch(t, "roofing")).toBe(false);
  });

  it("groups by day and snoozes to 9 AM", () => {
    const now = new Date(2026, 9, 1, 11, 0);
    expect(dayGroup(new Date(2026, 9, 1, 8).toISOString(), now)).toBe("Today");
    expect(dayGroup(new Date(2026, 8, 30, 8).toISOString(), now)).toBe("Yesterday");
    expect(dayGroup(new Date(2026, 8, 27, 8).toISOString(), now)).toBe("Earlier this week");
    const tmr = snoozeUntil("tomorrow", now);
    expect([tmr.getDate(), tmr.getHours()]).toEqual([2, 9]);
    const mon = snoozeUntil("monday", now); // Thursday Oct 1 2026
    expect([mon.getDay(), mon.getDate(), mon.getHours()]).toEqual([1, 5, 9]);
  });
});

describe("Delete", () => {
  const one = [msg({ id: "z", gmailThreadId: "tz", at: "2026-10-01T17:00:00Z" })];
  it("moves a conversation to Trash and out of every other folder", () => {
    const s = new Map([["gm:tz", st({ threadKey: "gm:tz", trashedAt: "2026-10-01T17:10:00Z", doneAt: "2026-10-01T17:05:00Z" })]]);
    const t = buildThreads(one, s, { now: NOW })[0];
    expect(inFolder(t, "trash", none)).toBe(true);
    expect(inFolder(t, "inbox", none)).toBe(false);
    expect(inFolder(t, "done", none)).toBe(false);
    expect(inFolder(t, "email", none)).toBe(false);
  });
});

describe("reading an email full of links", () => {
  it("shows each link as its website, and collapses repeats", async () => {
    const { bodyParts } = await import("./inboxModel");
    const parts = bodyParts("Hi [https://email.email.clickuplocal.com/c/eJx0" + "x".repeat(400) + "] there https://www.kp.org/a?b=1 https://www.kp.org/c, bye");
    expect(parts).toEqual([
      { text: "Hi " }, { url: "https://email.email.clickuplocal.com/c/eJx0" + "x".repeat(400), label: "email.email.clickuplocal.com" },
      { text: " there " }, { url: "https://www.kp.org/a?b=1", label: "kp.org" }, { text: ", bye" },
    ]);
  });
});

describe("Star", () => {
  it("shows in Starred and stays where it was", () => {
    const one = [msg({ id: "s1", gmailThreadId: "ts" })];
    const s = new Map([["gm:ts", st({ threadKey: "gm:ts", starredAt: "2026-10-01T17:10:00Z" })]]);
    const t = buildThreads(one, s, { now: NOW })[0];
    expect(t.starred).toBe(true);
    expect(inFolder(t, "starred", none)).toBe(true);
    expect(inFolder(t, "inbox", none)).toBe(true);
  });
});

describe("day dividers", () => {
  it("says Today, Yesterday, then the date", async () => {
    const { dayLabel } = await import("./inboxModel");
    const now = new Date(2026, 9, 1, 15, 0);
    expect(dayLabel(new Date(2026, 9, 1, 9).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 8, 30, 16).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 8, 19, 15).toISOString(), now)).toMatch(/Sep 19/);
    expect(dayLabel(new Date(2025, 8, 19, 15).toISOString(), now)).toMatch(/2025/);
  });
});

describe("only you have written", () => {
  it("is in Sent, not the Inbox, until they reply", () => {
    const mine = [msg({ id: "o1", gmailThreadId: "to", direction: "outbound" })];
    const t = buildThreads(mine, new Map(), { now: NOW })[0];
    expect(inFolder(t, "inbox", none)).toBe(false);
    expect(inFolder(t, "email", none)).toBe(false);
    expect(inFolder(t, "sent", none)).toBe(true);
    const replied = buildThreads([...mine, msg({ id: "i1", gmailThreadId: "to", at: "2026-10-01T17:30:00Z" })], new Map(), { now: NOW })[0];
    expect(inFolder(replied, "inbox", none)).toBe(true);
  });
});
