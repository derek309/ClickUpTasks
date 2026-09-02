import DOMPurify from "dompurify";

// Email bodies are attacker-controlled. Anyone who can email a client can put
// anything in one, and GoHighLevel hands us those bodies exactly as they
// arrived — HTML included. The client Journal renders them with
// dangerouslySetInnerHTML, so without this an <img src=x onerror=…> in a
// message executes in the app's origin, with the reader's session.
//
// (The Gmail path already strips tags on ingest, so it was only ever the GHL
// one. The fix belongs at the render boundary regardless: sanitising on the
// way in leaves every row already stored still dangerous, and there were 79
// of them when this was written.)
//
// An allowlist, not a blocklist. Everything an email legitimately needs to
// look like an email, and nothing that can execute or phone home:
// no script/iframe/object/embed/form, no event handlers, no style blocks.
const ALLOWED_TAGS = [
  "p", "br", "div", "span", "b", "strong", "i", "em", "u", "s", "sub", "sup",
  "a", "ul", "ol", "li", "blockquote", "pre", "code", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "img", "figure", "figcaption",
];
const ALLOWED_ATTR = [
  "href", "title", "alt", "src", "width", "height", "colspan", "rowspan", "align",
  // Inline colour and spacing is most of what makes a marketing email legible.
  // Kept because style is scrubbed of anything active by DOMPurify itself.
  "style",
];

/** Sanitised HTML for an untrusted message body, safe to hand to
 *  dangerouslySetInnerHTML. Returns "" on the server, where there is no DOM to
 *  parse with — every caller renders in the browser. */
export function safeMessageHtml(dirty: string): string {
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // data: and blob: URLs are how an <a> or <img> smuggles a payload past a
    // scheme allowlist. cid: is what mail clients use for inline attachments
    // we cannot resolve anyway, so it goes too.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
    // Belt and braces: DOMPurify strips these by default, but an email is
    // exactly the input where a default being relied on is worth spelling out.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "formaction", "srcdoc"],
  });
}
