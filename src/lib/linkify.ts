import { chatLinkName, googleLinkName, linkPathName, linkSpans } from "@/lib/data";

// Links in anything people and Claude write (to dos, directions, comments,
// outcomes, the feed) read as short names, never as the raw address (Derek,
// 2026-10-14: a to do showed "https://mail.google.com/mail/u/0/#search/…").
// The full address stays in the link's tooltip.

/** A link's short name: what it is when we know (Gmail, Google Doc, ChatGPT
 *  chat), else its site and the last part of its path that reads as a name
 *  ("example.com · How to fix the thing"), else its site. */
export function shortLinkLabel(url: string): string {
  const known = googleLinkName(url) ?? chatLinkName(url);
  if (known) return known;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); } catch { return url.slice(0, 60); }
  const host = u.hostname.replace(/^www\./, "");
  const part = linkPathName(u);
  return part ? `${host} · ${part.length > 40 ? `${part.slice(0, 40).trimEnd()}…` : part}` : host;
}

export type TextPart = { text: string } | { href: string; label: string };

/** Text cut into its plain runs and its links, each link with its short name
 *  (or the label written for it, "label<url>"). */
export function linkifyParts(text: string, opts: { angleLabels?: boolean } = {}): TextPart[] {
  const out: TextPart[] = [];
  let last = 0;
  for (const { start, end, href, label } of linkSpans(text, opts)) {
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ href, label: label ?? shortLinkLabel(href) });
    last = end;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
