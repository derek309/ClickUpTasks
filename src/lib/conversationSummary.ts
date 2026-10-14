// The folded Conversation card's one line (Derek, 2026-10-14): how many
// things were said and the newest of them, "8 · last from Pam, 2h ago: Looks
// great! Can we change the…", "· last from us", "· a team note". The same
// things the Conversation tab counts: notes (not logged changes), messages
// other than calls, top level actions and the client's meetings since the
// task was made.
import { htmlToText, timeAgo, type Comment, type Message, type TaskAction, type ClientNote } from "./data";

/** The first words of a text, about `max` characters, cut at a word. */
export function snippet(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:!?]+$/, "")}…`;
}

type Said = { at: string; who: string; text: string };

export function conversationSummary({ comments, messages, actions, meetings, taskCreatedAt, firstName, ago = timeAgo }: {
  comments: Comment[];
  messages?: Message[] | null;
  actions?: TaskAction[] | null;
  meetings?: ClientNote[] | null;
  taskCreatedAt: string;
  firstName: string;
  ago?: (iso: string) => string;
}): { count: number; line: string } {
  const said: Said[] = [
    ...comments.filter((c) => c.kind !== "event").map((c) => ({ at: c.at, who: "a team note", text: c.body })),
    ...(messages ?? []).filter((m) => m.channel !== "call").map((m) => ({
      at: m.at,
      who: m.direction === "inbound" ? `last from ${(m.peerName ?? "").trim().split(/\s+/)[0] || firstName}` : "last from us",
      text: htmlToText(m.body).trim() || m.subject?.trim() || "",
    })),
    ...(actions ?? []).filter((a) => !a.parentId).map((a) => ({ at: a.at, who: a.kind === "note" || a.kind === "team" || a.kind === "delegate" ? "a team note" : "last from us", text: a.body })),
    ...(meetings ?? []).filter((n) => n.at.slice(0, 10) >= taskCreatedAt.slice(0, 10)).map((n) => ({ at: n.at, who: "a meeting", text: htmlToText(n.body) })),
  ];
  if (!said.length) return { count: 0, line: "nothing yet" };
  const last = said.reduce((a, b) => (b.at > a.at ? b : a));
  const text = snippet(last.text);
  return { count: said.length, line: `${said.length} · ${last.who}, ${ago(last.at)}${text ? `: ${text}` : ""}` };
}
