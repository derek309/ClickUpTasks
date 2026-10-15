// Which of our GoHighLevel numbers a text goes out from (Derek, 2026-10-15,
// after Jeannie Kennedy asked "Are you texting me from another number?").
// Every connected sub account (location) has its own numbers; a text can only
// go to a contact from a number in the contact's own sub account, since a
// GoHighLevel contact id belongs to one location.
//
// The rule for which number a text uses unless someone picks another: the
// number this conversation last used (the one we last texted them from, or
// the one they last texted in to), so the client keeps seeing the same
// number; else the sub account's default number. Pure, used by the composer
// (to show it) and by the send routes (to use it), so both agree.

/** One number we can text from. */
export type TextNumber = {
  /** E.164, as GoHighLevel keeps it ("+15303620990"). */
  number: string;
  /** GoHighLevel's friendly name, or whose line it is; null when neither. */
  label: string | null;
  locationId: string;
  /** The sub account's name ("ClickUpLocal", "ClickUpLocal Directory"). */
  locationName: string;
  isDefault: boolean;
};

/** A sub account and what came back for it: its numbers, or why there are none. */
export type TextAccount = { locationId: string; name: string; numbers: TextNumber[]; error?: string };

/** The digits that identify a phone number: the last ten, so "+1 (530) 362-0990"
 *  and "5303620990" are the same number. */
export function phoneKey(n: string | null | undefined): string {
  const d = String(n ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

export const samePhone = (a: string | null | undefined, b: string | null | undefined) => !!phoneKey(a) && phoneKey(a) === phoneKey(b);

/** A number as people read it, with no dashes (Derek's rule for copy):
 *  "+15303620990" is "(530) 362 0990". Anything that is not a ten digit
 *  North American number is shown as given, dashes turned to spaces. */
export function formatPhone(n: string | null | undefined): string {
  const raw = String(n ?? "").trim();
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : null;
  if (ten) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)} ${ten.slice(6)}`;
  return raw.replace(/-/g, " ").replace(/\s+/g, " ");
}

/** What the rule needs to know about a message in the conversation. */
export type FromHistoryItem = { channel: string; direction: string; at: string; ourNumber?: string | null };

/** The number this conversation last used: the newest text or call with our
 *  number on it, sent by us (our number is the one it came from) or by them
 *  (our number is the one they texted in to). Only numbers in `allowed` count
 *  when it is given (the contact's own sub account), so a number from another
 *  account is never the default. */
export function lastUsedNumber(history: FromHistoryItem[], allowed?: TextNumber[]): string | null {
  const ok = (n: string) => !allowed || allowed.some((x) => samePhone(x.number, n));
  const texts = history
    .filter((m) => (m.channel === "sms" || m.channel === "call") && !!m.ourNumber && ok(m.ourNumber))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return texts[0]?.ourNumber ?? null;
}

/** The number a text goes from unless someone picks another. Null when no
 *  number is known for the sub account (the list could not be read): the send
 *  then leaves it to GoHighLevel, as it always did. */
export function defaultFromNumber(o: { numbers: TextNumber[]; locationId: string | null; history: FromHistoryItem[] }): TextNumber | null {
  const mine = o.locationId ? o.numbers.filter((n) => n.locationId === o.locationId) : o.numbers;
  const last = lastUsedNumber(o.history, o.locationId ? mine : undefined);
  if (last) {
    const hit = mine.find((n) => samePhone(n.number, last));
    if (hit) return hit;
  }
  if (!o.locationId) return null;
  return mine.find((n) => n.isDefault) ?? mine[0] ?? null;
}

/** The number a send asked for, checked: it has to be one of ours, in the
 *  contact's sub account. Null (no pick) is fine: the default is used. */
export function checkFromNumber(requested: string | null | undefined, locationId: string, numbers: TextNumber[]): { ok: true; number: TextNumber | null } | { ok: false; error: string } {
  if (!requested || !String(requested).trim()) return { ok: true, number: null };
  const hit = numbers.find((n) => samePhone(n.number, requested));
  if (!hit) return { ok: false, error: `${formatPhone(requested)} isn't one of our GoHighLevel numbers.` };
  if (hit.locationId !== locationId) return { ok: false, error: `${formatPhone(hit.number)} is on ${hit.locationName}, and this person isn't in that account. Pick a number from their own account.` };
  return { ok: true, number: hit };
}

/** What a send goes out with: the number asked for, else the default.
 *  `number` is null when nothing is known; the text then goes from whatever
 *  GoHighLevel picks, as before. */
export function resolveFromNumber(o: { requested?: string | null; locationId: string; numbers: TextNumber[]; history: FromHistoryItem[] }): { ok: true; number: TextNumber | null } | { ok: false; error: string } {
  const asked = checkFromNumber(o.requested, o.locationId, o.numbers);
  if (!asked.ok || asked.number) return asked;
  return { ok: true, number: defaultFromNumber({ numbers: o.numbers, locationId: o.locationId, history: o.history }) };
}

/** GoHighLevel's send message body for a text. `fromNumber` makes it go out
 *  from that number (POST /conversations/messages, SendMessageBodyDto). */
export function ghlTextPayload(o: { type?: string; contactId: string; message: string; fromNumber?: string | null; userId?: string | null; attachments?: string[] }): Record<string, unknown> {
  return {
    type: o.type ?? "SMS", contactId: o.contactId, message: o.message,
    ...(o.fromNumber ? { fromNumber: o.fromNumber } : {}),
    ...(o.userId ? { userId: o.userId } : {}),
    ...(o.attachments?.length ? { attachments: o.attachments } : {}),
  };
}

/** For a sent bubble: the number it went from, and whether that is a change
 *  from our text before it (the "from a different number" warning). Messages
 *  oldest first; only ours with a known number are compared. */
export function fromNumberNotes(messages: { id: string; direction: string; channel: string; ourNumber?: string | null }[]): Map<string, { number: string; changed: boolean }> {
  const out = new Map<string, { number: string; changed: boolean }>();
  let prev: string | null = null;
  for (const m of messages) {
    if (m.direction !== "outbound" || (m.channel !== "sms" && m.channel !== "call") || !m.ourNumber) continue;
    out.set(m.id, { number: m.ourNumber, changed: !!prev && !samePhone(prev, m.ourNumber) });
    prev = m.ourNumber;
  }
  return out;
}

/** Our number on a GoHighLevel message, when GoHighLevel says it: the number
 *  a text of ours came from, or the one theirs came in to. Not in GoHighLevel's
 *  documented message fields, so read from every shape it might take and only
 *  kept when it looks like a phone number. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ourNumberOnGhlMessage(m: any): string | null {
  const inbound = m?.direction === "inbound";
  const pick = inbound
    ? [m?.to, m?.toNumber, m?.meta?.to, m?.meta?.sms?.to]
    : [m?.from, m?.fromNumber, m?.meta?.from, m?.meta?.sms?.from];
  const hit = pick.find((v) => typeof v === "string" && phoneKey(v).length >= 10);
  return (hit as string | undefined) ?? null;
}
