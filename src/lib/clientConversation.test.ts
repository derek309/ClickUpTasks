import { describe, expect, it } from "vitest";
import { collectClientDrafts, emailBeingAnswered, firstWords, newestLine, whereNewMessageGoes } from "./clientConversation";
import type { EmailDraft, Message, Task } from "./data";

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
    expect(whereNewMessageGoes({ channel: "email", tasks, messages, contactId: "ct_1", first: "Pamela" })).toEqual({ taskId: "t_ads", taskTitle: "Confirm the Medicare disclaimer", says: 'Goes on "Confirm the Medicare disclaimer", the task it answers' });
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
    expect(emailBeingAnswered(messages)).toEqual({ id: "i", subject: "Re: Disclaimer" });
  });
  it("is null once we wrote after them", () => {
    const messages = [
      msg({ id: "i", at: "2026-10-12T10:00:00Z", direction: "inbound", channel: "email", subject: "Hi" }),
      msg({ id: "o", at: "2026-10-13T10:00:00Z", direction: "outbound", channel: "email", subject: "Re: Hi" }),
    ];
    expect(emailBeingAnswered(messages)).toBeNull();
  });
});
