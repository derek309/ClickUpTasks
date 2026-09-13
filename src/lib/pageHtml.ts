// SERVER ONLY. A web page review's HTML (supabase/task-page-reviews.sql).
//
// The page is someone else's code, so the server never trusts what a browser
// makes of it. Three jobs, all on the stored file's own text:
//   framePage       number every element (data-cul-n) and add the bridge script,
//                   for the sandboxed frame only; the stored file is untouched
//   applyTextEdits  put a client's or teammate's rewording into the stored text,
//                   checking every "before" first, so nothing a page script did in
//                   the browser can ever reach a saved version
//   pageText        the words a person reads, for the History diff
// All three walk the page the same way (walk below), so element N is the same
// element in each. The browser side is public/page-bridge.js.
import { Parser } from "htmlparser2";
import { cleanEdit, PAGE_MAX_BYTES, PAGE_TOO_BIG, type PageEdit } from "./pageFrameProtocol";

export { PAGE_MAX_BYTES, PAGE_TOO_BIG };
export const PAGE_CHANGED = "Part of the page changed. Reload to see it.";
export const MAX_PAGE_EDITS = 500;
export const STAMP_ATTR = "data-cul-n";

export const pageTooBig = (html: string) => Buffer.byteLength(html, "utf8") > PAGE_MAX_BYTES;

// Nothing in these is numbered or editable: it is not text a person reads on the page.
const SKIP = new Set(["head", "script", "style", "template", "noscript", "textarea", "title", "iframe", "object", "select"]);

type Run = { node: number; start: number; end: number; text: string };
type Walked = { stamps: { node: number; at: number }[]; runs: Run[]; injectAt: number };

/** One pass over the page: where each numbered element's start tag ends, each
 *  numbered element's own runs of text (entities decoded, split pieces joined),
 *  and where a script can go first. Indices are into the original text. */
function walk(html: string): Walked {
  const stamps: Walked["stamps"] = [];
  const runs: Run[] = [];
  const stack: { name: string; node: number | null; skip: boolean }[] = [];
  let next = 0;
  let headEnd: number | null = null;
  let htmlEnd: number | null = null;
  let doctypeEnd: number | null = null;
  let last: Run | null = null;

  const parser = new Parser({
    onprocessinginstruction(name) {
      last = null;
      if (name.toLowerCase() === "!doctype" && doctypeEnd === null) doctypeEnd = parser.endIndex + 1;
    },
    onopentag(name, _attribs, implied) {
      last = null;
      if (!implied && name === "head" && headEnd === null) headEnd = parser.endIndex + 1;
      if (!implied && name === "html" && htmlEnd === null) htmlEnd = parser.endIndex + 1;
      const skip = SKIP.has(name) || (stack.length > 0 && stack[stack.length - 1].skip);
      let node: number | null = null;
      if (!skip && !implied && name !== "html") {
        node = next++;
        // Before the ">" (or the "/" of "/>") that ends the start tag.
        const end = parser.endIndex;
        stamps.push({ node, at: html[end - 1] === "/" ? end - 1 : end });
      }
      stack.push({ name, node, skip });
    },
    onclosetag(name) {
      last = null;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
    },
    oncomment() { last = null; },
    oncdatastart() { last = null; },
    ontext(data) {
      const top = stack[stack.length - 1];
      if (!top || top.skip || top.node === null) { last = null; return; }
      const start = parser.startIndex;
      const end = parser.endIndex + 1;
      if (last && last.node === top.node && last.end === start) {
        last.end = end;
        last.text += data;
      } else {
        last = { node: top.node, start, end, text: data };
        runs.push(last);
      }
    },
  });
  parser.write(html);
  parser.end();
  return { stamps, runs, injectAt: headEnd ?? htmlEnd ?? doctypeEnd ?? 0 };
}

function splice(html: string, inserts: { at: number; text: string }[]): string {
  let out = html;
  for (const { at, text } of [...inserts].sort((a, b) => b.at - a.at)) out = out.slice(0, at) + text + out.slice(at);
  return out;
}

/** The page as the frame serves it: every element numbered, and `head` (usually
 *  the bridge script tag) added before anything else runs. */
export function framePage(html: string, head = ""): string {
  const { stamps, injectAt } = walk(html);
  const inserts = stamps.map((s) => ({ at: s.at, text: ` ${STAMP_ATTR}="${s.node}"` }));
  if (head) inserts.push({ at: injectAt, text: head });
  return splice(html, inserts);
}

const normal = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rewordings as sent, or null when the list is malformed or too long. The latest
 *  edit to a piece of text wins. */
export function cleanEdits(raw: unknown): PageEdit[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_PAGE_EDITS) return null;
  const byKey = new Map<string, PageEdit>();
  for (const item of raw) {
    const edit = cleanEdit(item);
    if (!edit) return null;
    byKey.set(`${edit.node}:${edit.i}`, edit);
  }
  return [...byKey.values()];
}

/** The page with the rewording in. Each edit names an element and which of its
 *  own non blank text runs; the run must still read `before` (spaces aside), or
 *  nothing is applied. The new words are escaped, and the run's own leading and
 *  trailing whitespace stays, so the layout does not move. */
export function applyTextEdits(html: string, edits: PageEdit[]): { ok: true; html: string } | { ok: false; error: string } {
  const { runs } = walk(html);
  const byNode = new Map<number, Run[]>();
  for (const run of runs) {
    if (!normal(run.text)) continue;
    const list = byNode.get(run.node) ?? [];
    list.push(run);
    byNode.set(run.node, list);
  }
  const replacements: { start: number; end: number; text: string }[] = [];
  for (const edit of edits) {
    const run = byNode.get(edit.node)?.[edit.i];
    if (!run || normal(run.text) !== normal(edit.before)) return { ok: false, error: PAGE_CHANGED };
    const raw = html.slice(run.start, run.end);
    const lead = /^\s*/.exec(raw)?.[0] ?? "";
    const trail = /\s*$/.exec(raw)?.[0] ?? "";
    replacements.push({ start: run.start, end: run.end, text: lead + escapeText(edit.after.replace(/\s+/g, " ").trim()) + trail });
  }
  let out = html;
  for (const r of replacements.sort((a, b) => b.start - a.start)) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  return { ok: true, html: out };
}

// A line break after these, so the diff reads like the page.
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tr", "ul",
]);

/** The words a person reads on the page, one block per line, for the History diff. */
export function pageText(html: string): string {
  let out = "";
  let skipDepth = 0;
  const parser = new Parser({
    onopentag(name) { if (skipDepth || SKIP.has(name)) skipDepth++; },
    onclosetag(name) {
      if (skipDepth) { skipDepth--; return; }
      if (BLOCK.has(name)) out += "\n";
      // Cells, links and buttons sit side by side on screen, so their words stay apart.
      else if (name === "td" || name === "th" || name === "a" || name === "button" || name === "label") out += " ";
    },
    ontext(data) { if (!skipDepth) out += data; },
  });
  parser.write(html);
  parser.end();
  return out.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
