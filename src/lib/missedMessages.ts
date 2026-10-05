// Which direct messages need a "this is waiting on you" email (Derek,
// 2026-10-05: no email for every message any more, since the Inbox has them;
// only when one was left unanswered). Pure, so the rule can be tested.

export const WAIT_MS = 2 * 60 * 60 * 1000;
/** Older than this is history, not something to be reminded about. */
export const TOO_OLD_MS = 24 * 60 * 60 * 1000;

/** A sign off that needs no answer: "Perfect thank you.", "ok", "👍". */
export function needsNoAnswer(body: string): boolean {
  const t = body.trim().toLowerCase().replace(/[!.,\s]+$/g, "");
  if (!t) return true;
  if (/^[\p{Extended_Pictographic}\s]+$/u.test(t)) return true;
  return t.length <= 40 && !t.includes("?") && /^(ok(ay)?|k|cool|great|perfect|awesome|nice|sounds good|got it|thanks?( you)?( so much)?|thank you( so much)?|ty|thx|will do|done|yes|yep|sure|love it|amazing)\b/.test(t);
}

export type DmRow = { id: string; conversation_id: string; author_id: string; recipient_id: string; body: string; created_at: string; reminded_at: string | null };

/** Per conversation, the messages to the other person that they have not
 *  answered (nothing from them after) and nobody has been reminded about yet,
 *  when the first of them has waited long enough. One reminder per
 *  conversation and recipient, carrying every message in the wait. */
export function waitingOn(rows: DmRow[], now: number): { recipientId: string; authorId: string; conversationId: string; messages: DmRow[] }[] {
  const byConv = new Map<string, DmRow[]>();
  for (const r of rows) byConv.set(r.conversation_id, [...(byConv.get(r.conversation_id) ?? []), r]);
  const out: { recipientId: string; authorId: string; conversationId: string; messages: DmRow[] }[] = [];
  for (const [conversationId, list] of byConv) {
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = sorted[sorted.length - 1];
    // The unanswered run: the newest author's messages since the other one last wrote.
    const run: DmRow[] = [];
    for (let i = sorted.length - 1; i >= 0 && sorted[i].author_id === last.author_id; i--) run.unshift(sorted[i]);
    if (run.some((m) => m.reminded_at)) continue;
    if (needsNoAnswer(last.body)) continue;
    const first = new Date(run[0].created_at).getTime();
    if (now - first < WAIT_MS || now - first > TOO_OLD_MS) continue;
    out.push({ recipientId: last.recipient_id, authorId: last.author_id, conversationId, messages: run });
  }
  return out;
}

/** The email: a short note that it is waiting, then the messages themselves. */
export function reminderEmail(o: { authorName: string; messages: { body: string; created_at: string }[]; url: string; timeZone?: string }): { subject: string; body: string } {
  const first = o.authorName.split(/\s+/)[0] || o.authorName;
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: o.timeZone ?? "America/Los_Angeles" });
  const n = o.messages.length;
  return {
    subject: `${first} is waiting on you: ${n > 1 ? `${n} messages` : "a message"} in ClickUpTasks`,
    body: [
      `${first} sent you ${n > 1 ? `${n} messages` : "a message"} that ${n > 1 ? "haven't" : "hasn't"} been answered yet. It needs your attention.`,
      "",
      ...o.messages.map((m) => `${when(m.created_at)}: "${m.body.trim().slice(0, 600)}"`),
      "",
      `Answer it in your Inbox, under Team: ${o.url}`,
    ].join("\n"),
  };
}
