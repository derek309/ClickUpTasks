// A text message is plain words (Derek, 2026-10-08: a text went out as
// "<p>Haha ... <a href=...>book a time here</a></p>"). HTML from the rich
// editor, a saved reply or AI becomes lines, with each link written out as
// "label: address" so it can still be tapped. Plain text passes through.

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'", "#039": "'" };

export const looksLikeHtmlText = (s: string) => /<\/?(p|br|div|a|span|strong|b|em|i|ul|ol|li)\b[^>]*>/i.test(s);

export function smsText(input: string): string {
  if (!input || !looksLikeHtmlText(input)) return (input ?? "").trim();
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const words = label.replace(/<[^>]+>/g, "").trim();
      return !words || words === href || href.includes(words) ? href : `${words}: ${href}`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#0?39|[a-z]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m)
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
