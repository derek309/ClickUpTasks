import type { Client, Contact } from "./data";

// Whether two contacts are the same real business.
//
// The same business can exist as a contact in more than one GoHighLevel
// sub-account (the agency's and the directory's). Promote each and you get two
// client records for one entity, with its tasks and history split across them.
// This is the rule that stops that, lifted out of the component so it can be
// tested: it decides whether importing a contact quietly merges into an
// existing client or creates a second one, and it is easier to get subtly
// wrong than it looks.

/** Case and spacing folded, so "  Acme  Plumbing " matches "acme plumbing". */
export const dedupName = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The last ten digits, so +1 (555) 123-4567 and 5551234567 are one number.
 *  Shorter strings are kept as-is rather than padded into a false match. */
export const dedupPhone = (s: string | undefined) => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
};

/** Every contact id a tracked client "is": its own, plus anything it absorbed
 *  through a prior merge or a manual GoHighLevel link. */
export const clientContactIds = (cl: Client): string[] => [
  ...(cl.id.startsWith("cl_") ? [cl.id.slice(3)] : []),
  ...(cl.linkedContactId ? [cl.linkedContactId] : []),
  ...(cl.linkedContactIds ?? []),
];

/** Do these two contacts describe the same business?
 *
 *  Email and phone are identifiers and match outright. A name only matches
 *  above three characters: "Jo" or "ABC" would otherwise collapse unrelated
 *  businesses into one client, and a wrong merge is far more expensive to
 *  undo than a duplicate is to spot. */
export function sameContact(a: Pick<Contact, "email" | "phone" | "name">, b: Pick<Contact, "email" | "phone" | "name">): boolean {
  const email = (a.email ?? "").trim().toLowerCase();
  if (email && (b.email ?? "").trim().toLowerCase() === email) return true;
  const phone = dedupPhone(a.phone);
  if (phone && dedupPhone(b.phone) === phone) return true;
  const name = dedupName(a.name);
  return name.length > 3 && dedupName(b.name) === name;
}

/** The tracked client that already represents this contact, or null. */
export function findDuplicateTrackedClient(
  contact: Contact,
  clients: Client[],
  contactById: (id: string) => Contact | null,
): string | null {
  for (const cl of clients) {
    if (!cl.id.startsWith("cl_")) continue;
    if (cl.id === "cl_" + contact.id) continue; // itself
    for (const cid of clientContactIds(cl)) {
      const other = contactById(cid);
      if (other && sameContact(contact, other)) return cl.id;
    }
  }
  return null;
}
