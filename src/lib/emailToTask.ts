// Make it a task (Derek, 2026-10-15, step-flow-mockup.html, in a step's
// ＋ Add): a client's email that is really its own piece of work becomes a
// new task for the same client and list, named from the email's subject, with
// the email as step 1's incoming email (its files with it) and a line in step
// 1's directions linking back. The email stays on the step it came in on: a
// copy, not a move. The original task gets a comment linking forward (the
// caller adds it). Pure, so it can be tested.

import { taskFromStep, type Task } from "./data";
import { filesOfEmail } from "./emailFiles";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The new task's name: the email's subject without its Re: and Fwd:, else the step's name. */
export function nameFromEmail(subject: string | null | undefined, stepTitle: string): string {
  const s = (subject ?? "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  return (s || stepTitle.trim() || "New task").slice(0, 120);
}

/** The new task built from step `stepId`'s client email, or null when the step
 *  holds none. `link` is the address of the original task. */
export function taskFromEmail(src: Task, stepId: string, meId: string, now: string, makeId: (prefix: string) => string, link: string): Task | null {
  const sub = src.subtasks.find((x) => x.id === stepId);
  const emails = sub?.fromEmails ?? [];
  if (!sub || !emails.length) return null;
  const last = emails[emails.length - 1];
  const title = nameFromEmail(last.subject, sub.title);
  const base = taskFromStep(src, stepId, meId, now, makeId, `made this from the email on "${src.title}"`);
  if (!base) return null;
  // Its files, as they show with it on the original task (lib/emailFiles).
  const files = emails.flatMap((e) => filesOfEmail(e, src.attachments)).filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)
    .map((a) => ({ ...a, id: makeId("a_"), folderId: undefined, position: undefined }));
  const step1 = {
    id: makeId("s_"), title: sub.title.trim() || `Reply: ${title}`, done: false, startedAt: now,
    makes: "email" as const, addedFor: `reply:${last.messageId}`,
    fromEmails: emails.map((e) => ({ ...e })),
    notes: `<p>From <a href="${esc(link)}">${esc(src.title)}</a></p>`,
    assigneeId: meId,
  };
  return { ...base, title, assigneeId: meId, due: null, subtasks: [step1], attachments: files };
}
