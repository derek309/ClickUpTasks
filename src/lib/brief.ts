// Project instructions on a task (supabase/task-briefs.sql): what the team writes
// for an outside person, a Fiverr designer say, and shares through one read only
// link. Shared by the team's window, the outside page and the server, so no
// imports.
//
// Derek, 2026-09-30: "a deliverable for project instructions that we can create a
// document and then share it with a Fiverr or a third party to do the design",
// "it needs to be separate from document though". Picked A from the mockup.

/** The outside link: `brf_` plus 32 random bytes in base64url. Checked before
 *  anything touches the database. */
export const BRIEF_TOKEN_PATTERN = /^brf_[A-Za-z0-9_-]{43}$/;
export const BRIEF_FILE_ID = /^tbf_[0-9a-f-]{36}$/;

/** How long a new link works, in days, and what the team picks from. */
export const BRIEF_LINK_DAYS = [7, 14, 30] as const;
export const DEFAULT_BRIEF_LINK_DAYS = 14;
export const cleanLinkDays = (raw: unknown): number =>
  (BRIEF_LINK_DAYS as readonly unknown[]).includes(raw) ? raw as number : DEFAULT_BRIEF_LINK_DAYS;
export const linkDaysLabel = (days: number) => (days === 7 ? "1 week" : days === 14 ? "2 weeks" : `${days} days`);

/** The line in the task and the window's name while none is typed. */
export const BRIEF_TITLE = "Project instructions";

export type BriefTemplate = { id: "design" | "outline" | "blank"; name: string; hint: string; html: string };

/** Where a new set of instructions can start. The headings are the ones a designer
 *  reads for; the AI fills the same ones. */
export const BRIEF_TEMPLATES: BriefTemplate[] = [
  {
    id: "design", name: "Design brief", hint: "Job, sizes, must include, style, send back",
    html: "<h2>The job</h2><p></p><h2>Size and format</h2><p></p><h2>Must include</h2><ul><li><p></p></li></ul><h2>Look and feel</h2><p></p><h2>Send back</h2><p></p>",
  },
  {
    id: "outline", name: "Project outline", hint: "Goal, scope, steps, dates, done means",
    html: "<h2>Goal</h2><p></p><h2>Scope</h2><p></p><h2>Steps</h2><ol><li><p></p></li></ol><h2>Dates</h2><p></p><h2>Done means</h2><p></p>",
  },
  { id: "blank", name: "Blank", hint: "A title and an empty page", html: "" },
];

export const templateHtml = (id: unknown): string => BRIEF_TEMPLATES.find((t) => t.id === id)?.html ?? "";

// Phone numbers and email addresses never go into instructions that leave the
// building. The AI is told so; this makes sure of it.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Seven or more digits with the usual separators, optionally +country: a phone
// number, not a price, a size or a year.
const PHONE = /(?:\+?\d[\s().-]*){7,}\d/g;

/** Takes email addresses and phone numbers out of text the AI wrote. */
export function scrubContacts(text: string): string {
  return text.replace(EMAIL, "").replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "" : m));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e]);

/** The instructions as plain text, to paste into a Fiverr message: the title and
 *  due date on top, headings in capitals, list items as bullets, the files
 *  named at the end. Works on the editor's own HTML without a DOM. */
export function briefToText(input: { title: string; due: string | null; html: string; files: string[] }): string {
  const body = decode(input.html
    // The editor wraps each list item's text in a paragraph; the bullet is the line.
    .replace(/<li([^>]*)>\s*<p[^>]*>/gi, "<li$1>").replace(/<\/p>\s*<\/li>/gi, "</li>")
    .replace(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi, (_, inner: string) => `\n\n\u0001${inner.replace(/<[^>]+>/g, "").trim().toUpperCase()}\n`)
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<\/?(ul|ol|blockquote|pre)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .split("\n").map((l) => l.trim()).filter((l) => l !== "•")
    .join("\n").replace(/\n{3,}/g, "\n\n")
    // A heading sits right on top of what it heads; \u0001 marked each one above.
    .replace(/(\u0001[^\n]*)\n\n/g, "$1\n").replace(/\u0001/g, "").trim();
  const head = [input.title.trim() || BRIEF_TITLE, input.due ? `Due ${formatDue(input.due)}` : ""].filter(Boolean).join("\n");
  const files = input.files.length ? `\n\nFiles: ${input.files.join(", ")}` : "";
  return `${head}\n\n${body}${files}`.trim();
}

/** "Mon, Oct 6" from a yyyy-mm-dd date, read as that calendar day wherever you are. */
export function formatDue(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** A yyyy-mm-dd date or null. */
export const cleanDue = (raw: unknown): string | null | undefined =>
  raw === null || raw === "" ? null
    : typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw
      : undefined;

/** The name an outside person typed, kept short and on one line. */
export const cleanOutsideName = (raw: unknown): string =>
  typeof raw === "string" ? raw.replace(/[\x00-\x1f\x7f<>"]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
