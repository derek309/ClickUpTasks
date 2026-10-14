/** What to call a client in a line or a greeting: the person's first name when
 *  their contact is a person, otherwise the client's whole name. Taking the
 *  first word of a business made "Nothing waiting on The" for The Artist
 *  Workshop (Derek, 2026-10-13); the Quick step's "Email The" was the same bug.
 *  A contact is not a person when it has no name, is named for an email, is
 *  GoHighLevel's "Unnamed contact", starts with "The", or carries the same name
 *  as its company. */
export function clientFirstName(
  contact: { name?: string | null; company?: string | null } | null | undefined,
  clientName: string | null | undefined,
  fallback = "them",
): string {
  const clean = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
  const name = clean(contact?.name);
  const company = clean(contact?.company);
  const person = !!name && !name.includes("@") && !/^unnamed contact$/i.test(name) && !/^the\s/i.test(name)
    && !(company && name.toLowerCase() === company.toLowerCase());
  if (person) return name.split(" ")[0];
  return clean(clientName) || fallback;
}
