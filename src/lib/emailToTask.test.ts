import { describe, expect, it } from "vitest";
import { nameFromEmail, taskFromEmail } from "./emailToTask";
import type { Task } from "./data";

const NOW = "2026-10-15T16:00:00.000Z";
let n = 0;
const makeId = (p: string) => `${p}${++n}`;
const src = {
  id: "t_orig", projectId: "p_ads", clientId: "cl_pam", contactId: "c_pam", title: "Facebook ad: Coffee and Medicare", description: "", status: "in_progress", priority: "high",
  assigneeId: "u_derek", waitingOnClient: false, due: "2026-10-20", followUpAt: null, private: false, hiddenFromClient: false, createdAt: NOW,
  attachments: [
    { id: "a1", name: "menu.pdf", kind: "pdf", size: "1 MB", path: "t_orig/menu.pdf", emailSource: "email:k1:0" },
    { id: "a2", name: "other.pdf", kind: "pdf", size: "1 MB", path: "t_orig/other.pdf" },
  ],
  comments: [],
  subtasks: [
    { id: "s1", title: "Reply to Pamela: Restaurant classes", done: false, notes: "<p>Old directions</p>", todos: [{ id: "td", title: "x", done: false }],
      fromEmails: [{ messageId: "m1", from: "Pamela Macias", subject: "Re: Restaurant classes", body: "Here are the dates", at: NOW, fileKey: "k1" }], holds: ["email"] },
  ],
} as unknown as Task;

describe("Make it a task", () => {
  it("names it from the email's subject without Re:", () => {
    expect(nameFromEmail("Re: Fwd: Restaurant classes", "Reply to Pam")).toBe("Restaurant classes");
    expect(nameFromEmail("", "Reply to Pam")).toBe("Reply to Pam");
  });
  it("a new task for the same client and list, the email as step 1 with its files, linked back", () => {
    const t = taskFromEmail(src, "s1", "u_derek", NOW, makeId, "https://tasks/?task=t_orig")!;
    expect(t).toMatchObject({ clientId: "cl_pam", projectId: "p_ads", title: "Restaurant classes", assigneeId: "u_derek", status: "todo", due: null });
    expect(t.id).not.toBe("t_orig");
    expect(t.subtasks).toHaveLength(1);
    const s1 = t.subtasks[0];
    expect(s1.fromEmails).toEqual(src.subtasks[0].fromEmails);
    expect(s1.fromEmails![0]).not.toBe(src.subtasks[0].fromEmails![0]);
    expect(s1.notes).toBe('<p>From <a href="https://tasks/?task=t_orig">Facebook ad: Coffee and Medicare</a></p>');
    expect(s1).toMatchObject({ done: false, startedAt: NOW, makes: "email", addedFor: "reply:m1" });
    expect(s1.todos).toBeUndefined();
    expect(t.attachments.map((a) => a.name)).toEqual(["menu.pdf"]);
    expect(t.attachments[0].id).not.toBe("a1");
    expect(t.attachments[0].emailSource).toBe("email:k1:0");
  });
  it("leaves the original task as it was (a copy, not a move)", () => {
    const before = JSON.stringify(src);
    taskFromEmail(src, "s1", "u_derek", NOW, makeId, "x");
    expect(JSON.stringify(src)).toBe(before);
  });
  it("needs an email on the step", () => {
    expect(taskFromEmail({ ...src, subtasks: [{ id: "s2", title: "Design", done: false }] } as Task, "s2", "u_derek", NOW, makeId, "x")).toBeNull();
  });
});
