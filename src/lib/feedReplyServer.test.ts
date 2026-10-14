import { describe, expect, it, vi } from "vitest";
import type { Message, Subtask } from "./data";

vi.mock("./supabaseAdmin", () => ({ supabaseAdmin: {} }));
const { conversationLines, feedReplyPrompt, taskLines, FEED_REPLY_MESSAGES } = await import("./feedReplyServer");

const msg = (p: Partial<Message> & Pick<Message, "id" | "at" | "direction" | "channel">): Message => ({
  contactId: "ct_1", clientId: "cl_1", taskId: null, subject: null, body: "", ghlMessageId: null, createdBy: null, read: true, attachments: [], cc: [], bcc: [], ...p,
});

describe("conversationLines", () => {
  it("reads the newest messages oldest first, the automatic ones left out", () => {
    const ms = Array.from({ length: 14 }, (_, i) => msg({ id: `m${i}`, at: `2026-10-${String(i + 1).padStart(2, "0")}T12:00:00Z`, direction: i % 2 ? "outbound" : "inbound", channel: "sms", body: `line ${i}`, createdBy: i % 2 ? "u_derek" : null }));
    ms.push(msg({ id: "r", at: "2026-10-20T12:00:00Z", direction: "outbound", channel: "sms", body: "[Reminder] Our appointment is starting shortly" }));
    const out = conversationLines(ms, "Carol");
    expect(out.split("\n\n")).toHaveLength(FEED_REPLY_MESSAGES);
    expect(out).not.toContain("line 3");
    expect(out).not.toContain("Reminder");
    expect(out.startsWith("CAROL (text, 2026-10-05):\nline 4")).toBe(true);
    expect(out.endsWith("US (text, 2026-10-14):\nline 13")).toBe(true);
  });
});

describe("taskLines", () => {
  it("gives the task's directions and its steps, the current one with its directions and to dos", () => {
    const steps = [
      { id: "s1", title: "Ask Carol for content", done: true },
      { id: "s2", title: "Build the page", done: false, notes: "<p>Use her old pet care text</p>", todos: [{ id: "d1", title: "Payment link", done: false }, { id: "d2", title: "Photos", done: true }] },
      { id: "s3", title: "Send for review", done: false },
    ] as Subtask[];
    const out = taskLines({ title: "Pet care page", status: "waiting", description: "<p>A page with payments</p>", subtasks: steps });
    expect(out).toContain("Directions: A page with payments");
    expect(out).toContain("1. Ask Carol for content (done)");
    expect(out).toContain("2. Build the page (current)\n   Directions: Use her old pet care text\n   Still to do:\n   - Payment link");
    expect(out).not.toContain("Photos");
    expect(out).toContain("3. Send for review (to do)");
  });
});

describe("feedReplyPrompt", () => {
  const base = { me: "Derek", first: "Carol", conversation: "CAROL (portal chat, 2026-10-14):\nAm I able to?", task: "Title: Pet care page" };
  it("keeps a text short and an email in the email shape", () => {
    expect(feedReplyPrompt({ ...base, channel: "sms" })).toMatch(/under 300 characters/);
    expect(feedReplyPrompt({ ...base, channel: "chat" })).toMatch(/portal chat message/);
    const email = feedReplyPrompt({ ...base, channel: "email" });
    expect(email).toContain("SUBJECT:");
    expect(email).toContain("No sign off");
  });
  it("answers the client from the conversation and the task, inventing nothing", () => {
    const p = feedReplyPrompt({ ...base, channel: "sms" });
    expect(p).toContain("to Carol");
    expect(p).toContain("Am I able to?");
    expect(p).toContain("THE TASK THIS MESSAGE GOES ON");
    expect(p).toMatch(/Never invent dates/);
    expect(feedReplyPrompt({ ...base, channel: "sms", task: null })).not.toContain("THE TASK");
  });
});
