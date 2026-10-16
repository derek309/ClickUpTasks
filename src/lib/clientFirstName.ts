/** What to call a client in a line or a greeting: the person's first name when
 *  their contact is a person, otherwise the client's name. Taking the first
 *  word of a business made "Nothing waiting on The" for The Artist Workshop
 *  (Derek, 2026-10-13); the Quick step's "Email The" was the same bug.
 *  A contact is not a person when it has no name, is named for an email, is
 *  GoHighLevel's "Unnamed contact", starts with "The", or carries the same name
 *  as its company.
 *
 *  With no person on the contact, a client named for a person says their first
 *  name too ("Carol Lindenmuth" is "Carol", Derek 2026-10-16: "Carol's turn",
 *  "Text Carol"); a business keeps its whole name (clientIsBusiness). */
export function clientFirstName(
  contact: { name?: string | null; company?: string | null } | null | undefined,
  clientName: string | null | undefined,
  fallback = "them",
): string {
  const name = clean(contact?.name);
  const company = clean(contact?.company);
  const person = !!name && !name.includes("@") && !/^unnamed contact$/i.test(name) && !/^the\s/i.test(name)
    && !(company && name.toLowerCase() === company.toLowerCase());
  if (person) return name.split(" ")[0];
  const client = clean(clientName);
  if (!client) return fallback;
  return clientIsBusiness(client) ? client : client.split(" ")[0];
}

const clean = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");

/** Words that make a name a business, not a person. */
const BUSINESS_WORDS = new Set([
  "inc", "llc", "llp", "ltd", "pllc", "pc", "corp", "corporation", "co", "company", "group", "partners", "partner", "associates",
  "agency", "workshop", "studio", "studios", "club", "realty", "real", "homes", "home", "insurance", "automotive", "auto", "motors",
  "bakery", "services", "service", "solutions", "consulting", "marketing", "media", "design", "designs", "construction",
  "properties", "property", "law", "legal", "dental", "medical", "clinic", "health", "fitness", "gym", "salon", "spa",
  "cafe", "restaurant", "kitchen", "bar", "grill", "winery", "vineyards", "vineyard", "farm", "farms", "shop", "store",
  "market", "center", "centre", "church", "school", "academy", "foundation", "institute", "sports", "team", "productions",
  "photography", "events", "travel", "tours", "pets", "pet", "care", "landscaping", "plumbing", "electric", "roofing",
  "cleaning", "financial", "capital", "ventures", "holdings", "enterprises", "industries", "labs", "systems", "technologies",
  "tech", "network", "collective", "society", "association", "rentals", "repair", "supply", "bros", "brothers", "sons",
  "trust", "bank", "mortgage", "lending", "wealth", "advisors", "hospitality", "hotel", "inn", "lodge", "resort", "coffee",
  "pizza", "brewing", "brewery", "gallery", "arts", "music", "dance", "yoga", "boutique", "florist", "flowers", "gardens",
  "nursery", "veterinary", "grooming", "ministries", "ministry", "theatre", "theater", "press", "publishing", "directory",
]);

/** A client named for a business: "The Artist Workshop", "Trinity Insurance
 *  Partners", "Lincoln Automotive", "Kim's Bakery", "Brandon & Vanessa", a
 *  name of more than 3 words. A person's name ("Carol Lindenmuth") is not. */
export function clientIsBusiness(name: string): boolean {
  const n = clean(name);
  if (!n) return false;
  const words = n.split(" ");
  if (words.length > 3) return true;
  if (/^the\s/i.test(n) || /[&@\d]|\.com\b|'s\b|’s\b/i.test(n)) return true;
  return words.some((w) => BUSINESS_WORDS.has(w.toLowerCase().replace(/[.,]/g, "")));
}

/** A sender's first name from how their email names them: "Proctor, Chelsea"
 *  is Chelsea (the step read "Reply to Proctor,", Derek 2026-10-16), and
 *  "Brian (via BibBoards)" is Brian. Empty when there is no name. */
export function senderFirstName(from: string | null | undefined): string {
  const name = clean(from).replace(/\s*\(via [^)]*\)\s*$/i, "").replace(/^["']|["']$/g, "").trim();
  const flipped = /^([^,\s]+),\s*(\S+)/.exec(name);
  return flipped ? flipped[2] : name.split(" ")[0] ?? "";
}
