// What the email window says about who it goes to (Derek, 2026-10-14): its
// title is the email itself, "Email to Ryan: Fall flyer", and its To line is
// the person's name with the address under it. Pure: no browser or server.
import { clientFirstName } from "./clientFirstName";

/** The recipient's name worth showing: none when it is blank, an address, or
 *  GoHighLevel's "Unnamed contact". */
export function recipientName(name: string | null | undefined): string | null {
  const clean = (name ?? "").trim().replace(/\s+/g, " ");
  return clean && !clean.includes("@") && !/^unnamed contact$/i.test(clean) ? clean : null;
}

/** "Email to Ryan: Fall flyer", "Email to Ryan" with no subject yet. A person
 *  goes by their first name, a business by its whole name (clientFirstName),
 *  and with no name the address stands in. With nobody to send to, the
 *  subject alone, or the window's own name (fallback). */
export function emailWindowTitle(toName: string | null | undefined, toEmail: string | null | undefined, subject: string, fallback = "Email"): string {
  const name = recipientName(toName);
  const who = name ? clientFirstName({ name }, name) : (toEmail ?? "").trim();
  const about = subject.trim().replace(/\s+/g, " ");
  if (!who) return about ? `${fallback}: ${about}` : fallback;
  return about ? `Email to ${who}: ${about}` : `Email to ${who}`;
}
