import sanitizeHtml from "sanitize-html";

// SERVER ONLY. The HTML of a client review document, cleaned the same way every
// time it is written and again before the public page reads it.
//
// This is the first place a page with no login returns HTML, and a client can
// type into it, so it gets its own allowlist rather than safeMessageHtml's:
// that one allows style and img for marketing email, needs a browser DOM, and
// returns "" on the server. sanitize-html needs no DOM, so it runs in a Vercel
// function without shipping jsdom.
//
// The allowlist is exactly what the TipTap editor (RichTextEditor.tsx) produces
// and nothing else: paragraphs, h2 and h3, bold, italic, underline, strike,
// code, quotes, lists, checklists, rules and links. Nothing the document shows
// is ever injected as raw HTML in the app: the editor re-parses it through its
// own schema, and the version diff renders plain text nodes. So this one server
// side pass is the only sanitizer, with no browser copy of the rules to drift.

/** Largest request body a document save may send (the editor's HTML plus JSON). */
export const DOC_MAX_RAW_CHARS = 512_000;
/** Largest a document may be once cleaned. */
export const DOC_MAX_HTML_CHARS = 200_000;

// A link must point somewhere safe to open. Checked on the href with control
// characters and whitespace removed first, because "java\tscript:" is a known
// way past a naive scheme check. Relative and protocol relative links are
// dropped: a document has no page of its own for them to be relative to.
const SAFE_HREF = /^(?:https?:|mailto:|tel:)/i;
const stripControls = (s: string) => s.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "h2", "h3", "strong", "em", "u", "s", "code", "pre", "blockquote", "ul", "ol", "li", "hr", "a"],
  allowedAttributes: {
    a: ["href", "rel", "target"],
    // TipTap's checklist: ul[data-type=taskList] > li[data-type=taskItem][data-checked].
    // The checked state lives on the li, so the label, checkbox input, span and
    // div wrappers TipTap also writes can all go; their text is kept.
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: {},
  allowProtocolRelative: false,
  // Unknown tags are removed but their text stays, so a pasted <div> or <span>
  // does not take the words inside it along.
  disallowedTagsMode: "discard",
  // These lose their contents too: nothing inside them is document text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "template", "iframe", "object", "embed", "svg", "math", "title", "head"],
  transformTags: {
    // The editor only has two heading levels, so a pasted h1 becomes the top one.
    h1: "h2",
    b: "strong",
    i: "em",
    strike: "s",
    del: "s",
    a: (_tagName, attribs) => {
      const href = (attribs.href ?? "").trim();
      const safe: sanitizeHtml.Attributes = {};
      if (SAFE_HREF.test(stripControls(href))) {
        safe.href = href;
        safe.rel = "noopener noreferrer nofollow";
        safe.target = "_blank";
      }
      return { tagName: "a", attribs: safe };
    },
    ul: (tagName, attribs) => {
      const safe: sanitizeHtml.Attributes = {};
      if (attribs["data-type"] === "taskList") safe["data-type"] = "taskList";
      return { tagName, attribs: safe };
    },
    li: (tagName, attribs) => {
      const safe: sanitizeHtml.Attributes = {};
      if (attribs["data-type"] === "taskItem") {
        safe["data-type"] = "taskItem";
        safe["data-checked"] = attribs["data-checked"] === "true" ? "true" : "false";
      }
      return { tagName, attribs: safe };
    },
  },
};

/** Clean document HTML. Idempotent: cleaning twice gives the same result. */
export function sanitizeDocHtml(html: string): string {
  return sanitizeHtml(html ?? "", OPTIONS).trim();
}
