// Who a reply to an email goes to, on the client and the server alike
// (Derek, 2026-10-16). A reply goes to whoever wrote the email it answers,
// with everyone else who was on it in Cc (reply all), less our own
// addresses. On Brian Goodell's task, Chelsea Proctor's email (she is not a
// contact, so the row has no client) was answered "To Brian Goodell", and
// Chelsea would never have seen it.

export const OUR_DOMAIN = "clickuplocal.com";

/** The parts of a messages row this needs (client and server shapes alike). */
export type ReplySource = {
  channel: string;
  /** "" or null: nobody we know wrote it (no contact, so no client). */
  clientId?: string | null;
  taskId?: string | null;
  peerAddress?: string | null;
  peerName?: string | null;
  cc?: string[] | null;
};

const norm = (a: string | null | undefined) => (a ?? "").trim().toLowerCase();

/** One of ours: any @clickuplocal.com address, or one of `own` (the mailbox it is sent from). */
export function isOurAddress(address: string, own: (string | null | undefined)[] = []): boolean {
  const a = norm(address);
  return a.endsWith(`@${OUR_DOMAIN}`) || own.some((o) => !!o && norm(o) === a);
}

/** "Proctor, Chelsea" as people say it: "Chelsea Proctor". */
export function readableName(name: string | null | undefined): string | null {
  const n = (name ?? "").replace(/\s*\(via [^)]*\)\s*$/i, "").replace(/^["']|["']$/g, "").trim();
  if (!n) return null;
  const flipped = /^([^,@]+),\s*([^,@]+)$/.exec(n);
  return flipped ? `${flipped[2].trim()} ${flipped[1].trim()}` : n;
}

/** The email belongs to what is being answered from: this client's own
 *  email, or one linked to this task (or to one of this client's tasks, when
 *  `taskClientId` says whose task it is), or one held on the step. An email
 *  of a different client, not on any of this client's tasks, never does. */
export function replyBelongs(m: ReplySource, scope: { clientId: string; taskId?: string | null; taskClientId?: string | null; onStep?: boolean }): boolean {
  if (m.clientId && m.clientId === scope.clientId) return true;
  if (scope.onStep) return true;
  if (!m.taskId) return false;
  if (scope.taskId && m.taskId === scope.taskId) return true;
  return !!scope.taskClientId && scope.taskClientId === scope.clientId;
}

/** Who the reply goes to: the person who wrote the email (or whom it went
 *  to, when it was ours). Null when it is not an email, has no address, or
 *  the address is ours. */
export function replyPeer(m: ReplySource | null | undefined): { email: string; name: string | null } | null {
  if (!m || m.channel !== "email") return null;
  const email = norm(m.peerAddress);
  if (!email.includes("@") || isOurAddress(email)) return null;
  return { email, name: readableName(m.peerName) };
}

/** Reply all: everyone else on the email (its To and Cc, which the row keeps
 *  in `cc`), less our own addresses and the person it now goes to. */
export function replyAllCc(m: ReplySource | null | undefined, to: string | null | undefined, own: (string | null | undefined)[] = []): string[] {
  if (!m || m.channel !== "email") return [];
  const seen = new Set<string>([norm(to)]);
  const out: string[] = [];
  for (const raw of m.cc ?? []) {
    const a = norm(raw);
    if (!a.includes("@") || seen.has(a) || isOurAddress(a, own)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}
