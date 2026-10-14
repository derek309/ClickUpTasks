import { describe, expect, it } from "vitest";
import { automaticKind, byTime, collectClientDrafts, dayLabel, defaultChannel, emailBeingAnswered, feedFileKey, feedFileSource, feedFiles, feedRows, firstWords, gmailFileHref, messageStamp, newestLine, sinceShort, taskChoices, timeOf, waitingLine, waitingOnReply, whereNewMessageGoes } from "./clientConversation";
import type { Attachment, EmailDraft, Message, Task } from "./data";

const msg = (p: Partial<Message> & Pick<Message, "id" | "at" | "direction" | "channel">): Message => ({
  contactId: "ct_1", clientId: "cl_1", taskId: null, subject: null, body: "", ghlMessageId: null, createdBy: null, read: true, attachments: [], cc: [], bcc: [], ...p,
});
const task = (p: Partial<Task> & Pick<Task, "id" | "title">): Task => ({
  projectId: "p_1", clientId: "cl_1", description: "", status: "todo", priority: "normal", assigneeId: null, contactId: "ct_1", due: null,
  recurrence: "none", labelIds: [], ghlTaskId: null, subtasks: [], attachments: [], comments: [], createdAt: "2026-10-01T00:00:00Z", ...p,
} as unknown as Task);
const draft = (p: Partial<EmailDraft> = {}): EmailDraft => ({ subject: "Ads", body: "<p>Hi Pamela, the ads are updated.</p>", createdAt: "2026-10-13T10:00:00Z", ...p });

describe("firstWords", () => {
  it("keeps a short line whole", () => {
    expect(firstWords("Got it, thanks!")).toBe("Got it, thanks!");
  });
  it("cuts a long line at a word with an ellipsis", () => {
    expect(firstWords("Use this one for California 14 organizations and 68 plans across the state", 40)).toBe("Use this one for California 14…");
  });
});

describe("newestLine", () => {
  const opts = { first: "Pamela", meId: "u_derek", nameOf: (id: string) => (id === "u_justin" ? "Justin Smith" : null), ago: () => "2h ago" };
  it("says what they wrote last, in their first name", () => {
    const line = newestLine([
      msg({ id: "a", at: "2026-10-12T10:00:00Z", direction: "outbound", channel: "email", body: "<p>Which disclaimer?</p>", createdBy: "u_derek" }),
      msg({ id: "b", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "email", body: "<p>Use this one for California.</p>", read: false }),
    ], opts);
    expect(line).toEqual({ text: 'Pamela, 2h ago: "Use this one for California."', theirs: true, unread: true, at: "2026-10-13T10:00:00Z" });
  });
  it("says You when you wrote last, and a teammate's first name when they did", () => {
    expect(newestLine([msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "outbound", channel: "sms", body: "Got it", createdBy: "u_derek" })], opts)?.text).toBe('You, 2h ago: "Got it"');
    expect(newestLine([msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "outbound", channel: "chat", body: "On it", createdBy: "u_justin" })], opts)?.text).toBe('Justin, 2h ago: "On it"');
  });
  it("leaves out calls and other inboxes, and is null with nothing said", () => {
    expect(newestLine([msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "call", body: "Missed call" })], opts)).toBeNull();
  });
});

describe("collectClientDrafts", () => {
  const notSent = () => false;
  it("gathers task emails, step texts, Claude's queue and the client's own email, oldest first", () => {
    const tasks = [
      task({ id: "t_1", title: "Reply to Pamela", draftEmail: draft({ updatedAt: "2026-10-13T12:00:00Z" }) }),
      task({ id: "t_2", title: "Testimonials", subtasks: [{ id: "s_1", title: "Text Pamela", done: false, startedAt: "2026-10-13T09:00:00Z", draftMessage: { channel: "sms", body: "Just a nudge" } }] as Task["subtasks"] }),
      task({ id: "t_3", title: "Done one", status: "done", draftEmail: draft() }),
    ];
    const out = collectClientDrafts({
      tasks, messages: [], sentAlready: notSent,
      queued: [{ id: "q_1", kind: "text", body: "From Claude", createdAt: "2026-10-13T08:00:00Z", by: "Claude" }],
      clientDraft: { clientId: "cl_1", draft: draft({ subject: "Quick check", createdAt: "2026-10-13T13:00:00Z" }) },
    });
    expect(out.map((d) => [d.id, d.kind, d.source])).toEqual([
      ["queued:q_1", "sms", "queued"],
      ["step:t_2:s_1", "sms", "step"],
      ["task:t_1", "email", "task"],
      ["client:cl_1", "email", "client"],
    ]);
    expect(out[2].text).toBe("Hi Pamela, the ads are updated.");
  });
  it("leaves off a task email that already went, a done step and an empty client email", () => {
    const tasks = [
      task({ id: "t_1", title: "Sent", draftEmail: draft() }),
      task({ id: "t_2", title: "Steps", subtasks: [{ id: "s_1", title: "Text", done: true, draftMessage: { channel: "sms", body: "old" } }] as Task["subtasks"] }),
    ];
    const out = collectClientDrafts({ tasks, messages: [], queued: [], sentAlready: (d) => d.subject === "Ads", clientDraft: { clientId: "cl_1", draft: draft({ subject: " ", body: "<p></p>" }) } });
    expect(out).toEqual([]);
  });
});

describe("whereNewMessageGoes", () => {
  const tasks = [
    task({ id: "t_ads", title: "Confirm the Medicare disclaimer" }),
    task({ id: "t_convo", title: "Reply to Pamela", priority: "conversation" }),
    task({ id: "t_meet", title: "Meeting with Pamela", priority: "conversation" }),
  ];
  it("goes on the task their newest message is on", () => {
    const messages = [msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "email", taskId: "t_ads" })];
    expect(whereNewMessageGoes({ channel: "email", tasks, messages, contactId: "ct_1", first: "Pamela" })).toEqual({ taskId: "t_ads", taskTitle: "Confirm the Medicare disclaimer", says: 'Goes on "Confirm the Medicare disclaimer", the task Pamela wrote on last' });
  });
  it("else on their open Conversation task, never a meeting's", () => {
    const messages = [msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "sms", taskId: null })];
    expect(whereNewMessageGoes({ channel: "sms", tasks, messages, contactId: "ct_1", first: "Pamela" }).taskId).toBe("t_convo");
    expect(whereNewMessageGoes({ channel: "sms", tasks: tasks.filter((t) => t.id !== "t_convo"), messages, contactId: "ct_1", first: "Pamela" }).taskId).toBeNull();
  });
  it("skips a task that is done", () => {
    const messages = [msg({ id: "a", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "email", taskId: "t_done" })];
    const out = whereNewMessageGoes({ channel: "email", tasks: [task({ id: "t_done", title: "Old", status: "done" })], messages, contactId: "ct_1", first: "Pamela" });
    expect(out).toEqual({ taskId: null, taskTitle: null, says: "Goes on Pamela's conversation, on no task" });
  });
  it("says a portal chat needs a task", () => {
    expect(whereNewMessageGoes({ channel: "chat", tasks: [], messages: [], contactId: "ct_1", first: "Pamela" }).says).toMatch(/needs a task/);
  });
});

describe("emailBeingAnswered", () => {
  it("answers their newest email when it is newer than ours", () => {
    const messages = [
      msg({ id: "o", at: "2026-10-12T10:00:00Z", direction: "outbound", channel: "email", subject: "Disclaimer" }),
      msg({ id: "i", at: "2026-10-13T10:00:00Z", direction: "inbound", channel: "email", subject: "Re: Disclaimer" }),
    ];
    expect(emailBeingAnswered(messages)).toEqual({ id: "i", subject: "Re: Disclaimer", taskId: null });
  });
  it("is null once we wrote after them", () => {
    const messages = [
      msg({ id: "i", at: "2026-10-12T10:00:00Z", direction: "inbound", channel: "email", subject: "Hi" }),
      msg({ id: "o", at: "2026-10-13T10:00:00Z", direction: "outbound", channel: "email", subject: "Re: Hi" }),
    ];
    expect(emailBeingAnswered(messages)).toBeNull();
  });
});

// The real texts on Amanda Standley's conversation (2026-10-13) and the other
// GoHighLevel workflows seen across clients.
const ghl = (body: string, p: Partial<Message> = {}) => msg({ id: "g", at: "2026-10-13T20:20:05Z", direction: "outbound", channel: "sms", body, ...p });
describe("automaticKind", () => {
  it("names the workflows' texts and emails", () => {
    expect(automaticKind(ghl("[Reminder] Our appointment is starting shortly at 1:30 PM (PDT), you can find the meeting details in the calendar Appointment. Talk shortly, Derek; ClickUpLocal"))).toBe("appointment reminder");
    expect(automaticKind(ghl("Hi Amanda,\n\nThis is a friendly reminder that your appointment with us starts in 10 minutes!", { channel: "email", subject: "Reminder: Upcoming Appointment on Tuesday, October 13, 2026 1:30 PM (PDT)" }))).toBe("appointment reminder");
    expect(automaticKind(ghl("Hi Amanda Standley, Your appointment has been rescheduled to Tuesday, October 13, 2026 1:30 PM (PDT). - Derek Fox; ClickUpLocal"))).toBe("appointment reminder");
    expect(automaticKind(ghl("Hi Amanda Standley, Our appointment is confirmed for Tuesday, October 13, 2026 1:00 PM (PDT), I've also sent a calendar invite."))).toBe("appointment reminder");
    expect(automaticKind(ghl("📅 Our meeting is starting right now! Check your email for the details!"))).toBe("appointment reminder");
    expect(automaticKind(ghl("Hey Amanda, it's ClickUpLocal! We're glad to inform you that we have confirmed your payment of $850.00. Thank you!"))).toBe("payment receipt");
    expect(automaticKind(ghl("Hey Brian, We're glad to inform that we have received payment of $900.00"))).toBe("payment receipt");
    expect(automaticKind(ghl("Hi Amanda Subscription payment of $850.00 for invoice ClickUpLocal: All-in-One Business Suite is due on October 13, 2026"))).toBe("invoice notice");
    expect(automaticKind(ghl("<p>AUTO PAYMENT INFORMATION</p>", { channel: "email", subject: "[ClickUpLocal] Invoice auto payment information" }))).toBe("invoice notice");
    expect(automaticKind(ghl("Location Logo\n\nTHANK YOU FOR YOUR RECENT PURCHASE\n\nDear Amanda,", { channel: "email", subject: "[ClickUpLocal] Thank you for your recent purchase" }))).toBe("purchase thank you");
    expect(automaticKind(ghl("Thanks for choosing us! Would you leave us a review? https://g.page/r/abc"))).toBe("review request");
    expect(automaticKind(ghl("Summary of the call", { channel: "email", subject: "AI Call Recap: Amanda Standley" }))).toBe("automatic message");
  });
  it("calls the calendar's Accepted reply automatic", () => {
    expect(automaticKind(msg({ id: "a", at: "2026-10-13T18:55:56Z", direction: "inbound", channel: "email", subject: "Accepted: 📹 Amanda Standley & Derek Fox; ClickUpLocal @ Tue Oct 13, 2026 1:30pm", body: "Loomis Basin Chamber of Commerce has accepted this invitation." }))).toBe("calendar reply");
  });
  it("leaves what a person wrote alone, from GoHighLevel's app or ours", () => {
    expect(automaticKind(ghl("I have lunch from 12-1"))).toBeNull();
    expect(automaticKind(ghl("Or I can talk now if you want to do that."))).toBeNull();
    expect(automaticKind(ghl("Our meeting is starting! Let me know", { createdBy: "u_derek" }))).toBeNull();
    expect(automaticKind(ghl("Please review: Newsletter", { channel: "email", subject: "Please review: Newsletter", createdBy: "u_derek" }))).toBeNull();
    expect(automaticKind(msg({ id: "a", at: "2026-10-13T17:13:28Z", direction: "inbound", channel: "sms", body: "Morning! I had thought we scheduled a zoom for today" }))).toBeNull();
  });
  it("calls a message the data marks as bulk automatic", () => {
    expect(automaticKind(ghl("Big news this week", { channel: "email", bulk: true }))).toBe("automatic message");
  });
  it("keeps the calendar's reply out of the email being answered", () => {
    const messages = [
      msg({ id: "i", at: "2026-10-09T15:32:12Z", direction: "inbound", channel: "email", subject: "Re: Calendar", taskId: "t_cal" }),
      msg({ id: "acc", at: "2026-10-13T18:55:56Z", direction: "inbound", channel: "email", subject: "Accepted: Zoom" }),
    ];
    expect(emailBeingAnswered(messages)).toEqual({ id: "i", subject: "Re: Calendar", taskId: "t_cal" });
  });
});

describe("dayLabel", () => {
  const now = new Date("2026-10-14T19:00:00Z");
  it("says Today, Yesterday, then the weekday and date, in Pacific time", () => {
    expect(dayLabel("2026-10-14T16:00:00Z", now)).toBe("Today");
    expect(dayLabel("2026-10-14T05:00:00Z", now)).toBe("Yesterday");
    expect(dayLabel("2026-10-13T05:00:00Z", now)).toBe("Mon, Oct 12");
  });
});

describe("feedRows", () => {
  const now = new Date("2026-10-14T19:00:00Z");
  const ms = [
    msg({ id: "a", at: "2026-10-13T17:13:28Z", direction: "inbound", channel: "sms", body: "Do you have time today?", taskId: "t_cal" }),
    msg({ id: "b", at: "2026-10-13T17:15:21Z", direction: "outbound", channel: "sms", body: "At 2", taskId: "t_cal", createdBy: "u_derek" }),
    msg({ id: "r", at: "2026-10-13T20:20:05Z", direction: "outbound", channel: "sms", body: "[Reminder] Our appointment is starting shortly", taskId: "t_cal" }),
    msg({ id: "c", at: "2026-10-14T18:06:26Z", direction: "outbound", channel: "sms", body: "Joining?", createdBy: "u_derek" }),
    msg({ id: "d", at: "2026-10-14T18:30:00Z", direction: "inbound", channel: "sms", body: "Yes" }),
    msg({ id: "call", at: "2026-10-14T18:31:00Z", direction: "inbound", channel: "call", body: "Call" }),
  ];
  const shape = (rows: ReturnType<typeof feedRows>) => rows.map((r) => r.kind === "day" ? `day ${r.label}` : r.kind === "task" ? `on ${r.taskId}` : r.kind === "auto" ? `auto ${r.label}` : r.kind === "new" ? "new" : r.m.id);
  it("puts a divider between days, the task once when it changes and folds the automatic ones", () => {
    expect(shape(feedRows(ms, { showAutomatic: false, seenAt: null, now }))).toEqual([
      "day Yesterday", "on t_cal", "a", "b", "auto appointment reminder", "day Today", "on null", "c", "d",
    ]);
  });
  it("shows the automatic ones whole when asked", () => {
    expect(shape(feedRows(ms, { showAutomatic: true, seenAt: null, now }))).toContain("r");
  });
  it("marks the first message from them since you last looked", () => {
    expect(shape(feedRows(ms, { showAutomatic: false, seenAt: "2026-10-14T00:00:00Z", now }))).toEqual([
      "day Yesterday", "on t_cal", "a", "b", "auto appointment reminder", "day Today", "on null", "c", "new", "d",
    ]);
    expect(shape(feedRows(ms, { showAutomatic: false, seenAt: "2026-10-14T19:00:00Z", now }))).not.toContain("new");
  });
});

describe("taskChoices", () => {
  it("lists the open tasks, the one talked on most lately first", () => {
    const tasks = [
      task({ id: "t_old", title: "Old", createdAt: "2026-09-01T00:00:00Z" }),
      task({ id: "t_new", title: "New", createdAt: "2026-10-10T00:00:00Z" }),
      task({ id: "t_talk", title: "Talked", createdAt: "2026-08-01T00:00:00Z" }),
      task({ id: "t_done", title: "Done", status: "done", createdAt: "2026-10-13T00:00:00Z" }),
    ];
    const messages = [{ taskId: "t_talk", at: "2026-10-13T10:00:00Z" }];
    expect(taskChoices(tasks, messages).map((t) => t.id)).toEqual(["t_talk", "t_new", "t_old"]);
  });
});

// Feed round 3 (Derek, 2026-10-14, Carol Lindenmuth's feed).
describe("time order", () => {
  it("reads every way an `at` arrives as the same instant", () => {
    const t = Date.parse("2026-10-07T16:15:06.490Z");
    expect(timeOf("2026-10-07 16:15:06.49+00")).toBe(t);
    expect(timeOf("2026-10-07T16:15:06.490076+00:00")).toBe(t);
    expect(timeOf("2026-10-07T16:15:06.490Z")).toBe(t);
    expect(timeOf("2026-10-07T09:15:06.490-07:00")).toBe(t);
    expect(timeOf("")).toBe(0);
  });
  it("lays a feed with mixed date formats out oldest first, the days in order", () => {
    const now = new Date("2026-10-14T21:30:00Z");
    const ms = [
      // Today, as the app stamps a send and with a local offset.
      msg({ id: "today2", at: "2026-10-14T21:19:49.872Z", direction: "outbound", channel: "email", subject: "Pet care page", createdBy: "u_derek", taskId: "t_pet" }),
      msg({ id: "today1", at: "2026-10-14T13:07:40-07:00", direction: "inbound", channel: "chat", body: "Am I able to?", taskId: "t_pet" }),
      // Oct 12, as Postgres writes it (a space, "+00").
      msg({ id: "oct12", at: "2026-10-12 20:43:58.192+00", direction: "inbound", channel: "sms", body: "Busy week", taskId: "t_web" }),
      // Oct 7, 9:15, 9:22 and 9:32 AM Pacific, as PostgREST sends it.
      msg({ id: "oct7c", at: "2026-10-07T16:32:08.305479+00:00", direction: "outbound", channel: "sms", body: "Awesome thank you.", createdBy: "u_derek" }),
      msg({ id: "oct7a", at: "2026-10-07T16:15:06.490076+00:00", direction: "outbound", channel: "email", subject: "Re: A first look", createdBy: "u_derek" }),
      msg({ id: "oct7b", at: "2026-10-07 16:22:56.822+00", direction: "inbound", channel: "sms", body: "Looks beautiful" }),
      // Oct 8.
      msg({ id: "oct8", at: "2026-10-08T21:32:36.692398+00:00", direction: "outbound", channel: "email", subject: "Ready for review", createdBy: "u_derek", taskId: "t_web" }),
    ];
    const rows = feedRows(ms, { showAutomatic: false, seenAt: null, now });
    expect(rows.filter((r) => r.kind === "message").map((r) => (r as { m: Message }).m.id)).toEqual(["oct7a", "oct7b", "oct7c", "oct8", "oct12", "today1", "today2"]);
    expect(rows.filter((r) => r.kind === "day").map((r) => (r as { label: string }).label)).toEqual(["Wed, Oct 7", "Thu, Oct 8", "Mon, Oct 12", "Today"]);
    // A string sort put the Postgres-written 9:22 ahead of 9:15; by the instant it is not.
    expect([...ms].sort((a, b) => a.at.localeCompare(b.at))[0].id).toBe("oct7b");
    expect([...ms].sort(byTime)[0].id).toBe("oct7a");
  });
  it("puts the date on a message's time unless it is today's", () => {
    const now = new Date("2026-10-14T21:30:00Z");
    expect(messageStamp("2026-10-07T16:15:06Z", now)).toBe("Oct 7, 9:15 AM");
    expect(messageStamp("2026-10-14T20:07:40Z", now)).toBe("1:07 PM");
  });
});

describe("whereNewMessageGoes, round 3", () => {
  // Carol: her newest email is on a task that's done, her newest chat (today) on an open one.
  const tasks = [
    task({ id: "t_email", title: "Update Carol email on the website", status: "done" }),
    task({ id: "t_pet", title: "Pet care page and payment setup", status: "waiting" as Task["status"] }),
    task({ id: "t_web", title: "Website Upgrade 2026", status: "waiting" as Task["status"] }),
    task({ id: "t_convo", title: "Reply to Carol", priority: "conversation" }),
  ];
  const carol = [
    msg({ id: "e", at: "2026-10-13T14:06:19+00:00", direction: "inbound", channel: "email", subject: "Re: This week", taskId: "t_email" }),
    msg({ id: "c", at: "2026-10-14 20:07:40.55723+00", direction: "inbound", channel: "chat", body: "Am I able to?", taskId: "t_pet" }),
  ];
  it("goes on the task of the client's newest message, whatever the channel", () => {
    for (const channel of ["email", "sms", "chat"] as const) {
      expect(whereNewMessageGoes({ channel, tasks, messages: carol, contactId: "ct_1", first: "Carol" }).taskId).toBe("t_pet");
    }
  });
  it("else the newest message's task, when the client's is done or on none", () => {
    const messages = [
      msg({ id: "e", at: "2026-10-13T14:06:19Z", direction: "inbound", channel: "email", taskId: "t_email" }),
      msg({ id: "o", at: "2026-10-14T21:19:49Z", direction: "outbound", channel: "email", taskId: "t_web", createdBy: "u_derek" }),
    ];
    expect(whereNewMessageGoes({ channel: "email", tasks, messages, contactId: "ct_1", first: "Carol" })).toMatchObject({ taskId: "t_web", says: 'Goes on "Website Upgrade 2026", the task of the newest message' });
  });
  it("else the open Conversation task, else no task", () => {
    const messages = [msg({ id: "e", at: "2026-10-13T14:06:19Z", direction: "inbound", channel: "email", taskId: "t_email" })];
    expect(whereNewMessageGoes({ channel: "email", tasks, messages, contactId: "ct_1", first: "Carol" }).taskId).toBe("t_convo");
    expect(whereNewMessageGoes({ channel: "email", tasks: tasks.filter((t) => t.id !== "t_convo"), messages, contactId: "ct_1", first: "Carol" }).taskId).toBeNull();
  });
  it("passes over automatic messages", () => {
    const messages = [...carol, msg({ id: "r", at: "2026-10-14T22:00:00Z", direction: "outbound", channel: "sms", body: "[Reminder] Our appointment is starting shortly", taskId: "t_web" })];
    expect(whereNewMessageGoes({ channel: "sms", tasks, messages, contactId: "ct_1", first: "Carol" }).taskId).toBe("t_pet");
  });
});

describe("defaultChannel", () => {
  const ms = [
    msg({ id: "e", at: "2026-10-13T14:06:19Z", direction: "inbound", channel: "email" }),
    msg({ id: "c", at: "2026-10-14T20:07:40Z", direction: "inbound", channel: "chat" }),
    msg({ id: "o", at: "2026-10-14T21:00:00Z", direction: "outbound", channel: "sms", createdBy: "u_derek" }),
  ];
  it("answers the way they wrote last", () => {
    expect(defaultChannel(ms, ["email", "sms", "chat"])).toBe("chat");
    expect(defaultChannel(ms.slice(0, 1), ["email", "sms"])).toBe("email");
  });
  it("falls back to the first way we can send", () => {
    expect(defaultChannel(ms, ["email", "sms"])).toBe("email");
    expect(defaultChannel([], ["sms"])).toBe("sms");
    expect(defaultChannel(ms, [])).toBeNull();
  });
});

describe("waitingOnReply", () => {
  const now = Date.parse("2026-10-14T22:07:40Z");
  it("is their newest message when they wrote last", () => {
    const ms = [
      msg({ id: "o", at: "2026-10-14T18:00:00Z", direction: "outbound", channel: "email", createdBy: "u_derek" }),
      msg({ id: "c", at: "2026-10-14 20:07:40+00", direction: "inbound", channel: "chat" }),
    ];
    expect(waitingOnReply(ms)).toEqual({ id: "c", at: "2026-10-14 20:07:40+00" });
    expect(waitingLine("Carol", "2026-10-14 20:07:40+00", now)).toBe("Carol's waiting on a reply · since 2h");
  });
  it("is null once we answered, and an automatic message is no answer", () => {
    const inbound = msg({ id: "c", at: "2026-10-14T20:07:40Z", direction: "inbound", channel: "chat" });
    expect(waitingOnReply([inbound, msg({ id: "o", at: "2026-10-14T21:00:00Z", direction: "outbound", channel: "sms", createdBy: "u_derek" })])).toBeNull();
    expect(waitingOnReply([inbound, msg({ id: "r", at: "2026-10-14T21:00:00Z", direction: "outbound", channel: "sms", body: "[Reminder] Our appointment is starting shortly" })])?.id).toBe("c");
    expect(waitingOnReply([])).toBeNull();
  });
  it("says how long, short", () => {
    expect(sinceShort("2026-10-14T22:05:00Z", now)).toBe("2m");
    expect(sinceShort("2026-10-13T12:00:00Z", now)).toBe("34h");
    expect(sinceShort("2026-10-10T12:00:00Z", now)).toBe("4d");
  });
});

describe("a message's files in the feed", () => {
  // James's "Trinity Branding Update" (Oct 5): three pictures kept in Gmail.
  const gm = (id: string, name: string, size: string, kind: Attachment["kind"] = "image"): Attachment => ({ id, name, size, kind, mimeType: "image/png", gmailAttachmentId: `g_${id}` });
  const james = msg({ id: "msg_e7", at: "2026-10-06T05:09:34Z", direction: "inbound", channel: "email", gmailMessageId: "1a10f9", attachments: [
    gm("at_1", "image.png", "265 KB"), gm("at_2", "image.png", "669 KB"), gm("at_3", "image.png", "106 KB"),
  ] });
  it("shows a picture kept in Gmail as a picture, read through the attachment route", () => {
    expect(feedFiles(james).pictures.map((a) => a.id)).toEqual(["at_1", "at_2", "at_3"]);
    expect(feedFiles(james).files).toEqual([]);
    expect(feedFileSource(james, james.attachments[0])).toEqual({ from: "gmail", href: "/api/inbox/attachment?message=msg_e7&att=at_1" });
    expect(feedFileSource(james, james.attachments[0], true)).toEqual({ from: "gmail", href: "/api/inbox/attachment?message=msg_e7&att=at_1&download=1" });
  });
  it("reads a stored file by its path, and a link by its address", () => {
    const stored: Attachment = { id: "a1", name: "logo.png", size: "40 KB", kind: "image", path: "messages/cl_1/f_1-logo.png" };
    const pdf: Attachment = { id: "a2", name: "plan.pdf", size: "1 MB", kind: "pdf", path: "messages/cl_1/f_2-plan.pdf" };
    const link: Attachment = { id: "a3", name: "Drive folder", size: "", kind: "link", url: "https://drive.google.com/x" };
    const m = msg({ id: "m1", at: "2026-10-06T05:09:34Z", direction: "outbound", channel: "email", attachments: [stored, pdf, link] });
    expect(feedFileSource(m, stored)).toEqual({ from: "storage", path: stored.path });
    expect(feedFileSource(m, link)).toEqual({ from: "link", url: link.url });
    expect(feedFiles(m)).toEqual({ pictures: [stored], files: [pdf, link] });
    expect(feedFileKey(stored)).toBe(stored.path);
    expect(feedFileKey(james.attachments[0])).toBe("at_1");
  });
  it("keeps a file that can't be read as a chip, and leaves a signature's logo out", () => {
    const noGmail = msg({ id: "m2", at: "2026-10-06T05:09:34Z", direction: "inbound", channel: "email", attachments: [gm("at_9", "photo.jpg", "300 KB")] });
    expect(feedFileSource(noGmail, noGmail.attachments[0])).toBeNull();
    expect(feedFiles(noGmail)).toEqual({ pictures: [], files: noGmail.attachments });
    const sig = msg({ id: "m3", at: "2026-10-06T05:09:34Z", direction: "inbound", channel: "email", gmailMessageId: "x", attachments: [gm("at_s", "image001.png", "8 KB")] });
    expect(feedFiles(sig)).toEqual({ pictures: [], files: [] });
  });
  it("escapes the ids in the attachment address", () => {
    expect(gmailFileHref("msg a&b", "at/1", true)).toBe("/api/inbox/attachment?message=msg%20a%26b&att=at%2F1&download=1");
  });
});
