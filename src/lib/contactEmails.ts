// A contact's other email addresses (Derek, 2026-10-07: Carol's address
// changed in GoHighLevel and her mail from the old one stopped matching her).
// Kept on contacts.additional_emails (supabase/contacts-additional-emails.sql):
// GoHighLevel's own additional emails, plus any main address they used to
// have, so their older mail still matches them.

const clean = (e: unknown): string => (typeof e === "string" ? e : (e as { email?: unknown } | null)?.email as string ?? "")
  .toString().trim().toLowerCase();

/** GoHighLevel's additionalEmails, which come as strings or as { email }. */
export function ghlExtraEmails(c: { additionalEmails?: unknown } | null | undefined): string[] {
  const list = Array.isArray(c?.additionalEmails) ? c!.additionalEmails as unknown[] : [];
  return [...new Set(list.map(clean).filter((e) => e.includes("@")))];
}

/** Their other addresses after a refresh: what GoHighLevel has, what we
 *  already kept, and the main address they had before if it changed. Never
 *  the main address itself; lower case, no repeats. */
export function mergeExtraEmails(primary: string | null | undefined, oldPrimary: string | null | undefined, kept: string[] | null | undefined, fromGhl: string[]): string[] {
  const main = clean(primary);
  const all = [...fromGhl, ...(kept ?? []), clean(oldPrimary)].map(clean);
  return [...new Set(all.filter((e) => e.includes("@") && e !== main))];
}

/** True until supabase/contacts-additional-emails.sql has run. */
export const missingExtraColumn = (error: { message?: string } | null | undefined) => !!error && /additional_emails/.test(error.message ?? "");
