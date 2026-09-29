// The client's SaaS link, as typed into the task drawer. Shared by the route
// that saves it to GoHighLevel and the drawer that saves it on the contact
// alone when the contact is not in GoHighLevel, so both store the same thing.

/** A bare "acme.com" becomes a working link everywhere it is shown, including
 *  inside GoHighLevel where we do not control the rendering. Empty stays empty. */
export function normalizeSaasUrl(raw: string): string {
  const v = raw.trim();
  return v && !/^https?:\/\//i.test(v) ? `https://${v}` : v;
}
