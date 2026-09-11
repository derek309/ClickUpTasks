// The review link in a drafted email (Derek, 2026-09-11: "make the link more
// obvious"). In the editor it is a large bold line placed where the AI asks the
// client to open it; on Send it goes out as a real button.

export type DraftLink = { url: string; label: string };

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the AI marks the link's spot (see /api/ai/draft-message). */
export const LINK_MARKER = "[[LINK]]";
const MARKER_BLOCK = /<p>\s*\[\[LINK\]\]\s*<\/p>/g;
const SIGN_OFF = /^(best|thanks|thank you|many thanks|cheers|regards|kind regards|warm regards|warmly|sincerely|talk soon|all the best)\b/i;

/** The link as the editor shows it: its own heading line, bold, which the rich text editor keeps. */
export const draftLinkHtml = (link: DraftLink | null | undefined) =>
  link ? `<h3><a href="${escapeHtml(link.url)}"><strong>${escapeHtml(link.label)} →</strong></a></h3>` : "";

/** Puts the link where the AI marked it; with no mark, just above the sign off, else at the end. */
export function placeDraftLink(html: string, link: DraftLink | null | undefined): string {
  const linkHtml = draftLinkHtml(link);
  let placed = false;
  const marked = html.replace(MARKER_BLOCK, () => {
    if (placed || !linkHtml) return "";
    placed = true;
    return linkHtml;
  }).split(LINK_MARKER).join("");
  if (placed || !linkHtml) return marked;
  const paras = marked.match(/<p>[\s\S]*?<\/p>/g) ?? [];
  const signOff = [...paras].reverse().find((p) => SIGN_OFF.test(p.replace(/<[^>]+>/g, "").trim()));
  if (!signOff) return marked + linkHtml;
  const at = marked.lastIndexOf(signOff);
  return marked.slice(0, at) + linkHtml + marked.slice(at);
}

/** On Send: the link's line becomes a button every mail app shows, keeping any wording the team changed. */
export function draftLinkAsButton(body: string, link: DraftLink | null | undefined): string {
  if (!link) return body;
  const href = escapeHtml(link.url);
  const block = new RegExp(`<(h[23]|p)>((?:(?!</\\1>)[\\s\\S])*?href="${escapeRegExp(href)}"(?:(?!</\\1>)[\\s\\S])*?)</\\1>`);
  return body.replace(block, (_whole, _tag, inner: string) => {
    const label = inner.replace(/<[^>]+>/g, "").replace(/\s*→\s*$/, "").trim() || escapeHtml(link.label);
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr>`
      + `<td style="background:#1f3350;border-radius:10px">`
      + `<a href="${href}" style="display:inline-block;padding:16px 32px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px">${label}</a>`
      + `</td></tr></table>`;
  });
}
