/** What a step's name says it needs, read as one or two of the step's Add
 *  menu items (Derek, 2026-10-13: an empty "Create plan and send to Ryan"
 *  should offer "Write the plan" and "Email Ryan", not a bare + Add).
 *
 *  Pure: words in the title only. The step page shows each one as a button
 *  that does what picking the same item from + Add does, and hides it once the
 *  step holds that kind of work. A call needs nothing made, so it suggests
 *  nothing. */
export type StepSuggestKind = "email" | "text" | "doc" | "image" | "page" | "video" | "checklist";
export type StepSuggestion = { kind: StepSuggestKind; label: string };

// "Draft an email", "write a text": the thing written is the message, not a document.
const MESSAGE_WRITING = /\b(?:write|draft)\s+(?:(?:an?|the|a quick)\s+)?(?:email|e-mail|text|reply|message|note)s?\b/gi;
const WRITE_TO = /\bwrite\s+(?:to|back)\b/gi;

// A newsletter is an email and the web page it links to (Derek, 2026-10-14).
const EMAIL_WORD = /\b(?:email|e-mail|emails|newsletter|newsletters)\b/i;
// Soft: these give way to a text ("Text blast" is the text, not an email).
const EMAIL_SOFT = /\b(?:send|reply|tell|write\s+(?:to|back)|blast|blasts|campaign|campaigns|follow[\s-]?up|follow[\s-]?ups|remind|reminder|reminders)\b|\blet\b.{0,40}?\bknow\b/i;
const TEXT_WORD = /\b(?:text|texts|sms)\b/i;
const DOC_NOUN = /\b(plan|proposal|brief|copy)\b/i;
const DOC_WORD = /\b(?:write|draft|document|doc|post|posts|blog|blogs|article|articles)\b/i;
// "ad" only as a word: "add" and "address" stay out.
const IMAGE_WORD = /\b(?:image|images|graphic|graphics|thumbnail|thumbnails|flyer|flyers|flier|fliers|postcard|postcards|banner|banners|ad|ads)\b/i;
const DESIGN_WORD = /\bdesign\b/i;
const PAGE_WORD = /\b(?:page|pages|landing|site|sites|website|websites|webpage|newsletter|newsletters)\b/i;
const VIDEO_WORD = /\b(?:video|videos|reel|reels|clip|clips)\b/i;
const CHECKLIST_WORD = /\b(?:checklist|list)\b/i;

const at = (re: RegExp, s: string) => { const m = re.exec(s); return m ? m.index : -1; };

/** Up to two of the Add menu's items the step's name points to, in the order
 *  the name says them. firstName is the client's, as clientFirstName gives it. */
export function suggestStepActions(title: string, firstName: string): StepSuggestion[] {
  const raw = (title ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  // An email or text being written counts as that message, not a document.
  const forDoc = raw.replace(MESSAGE_WRITING, (m) => " ".repeat(m.length)).replace(WRITE_TO, (m) => " ".repeat(m.length));
  // "Copy the files over" is the verb; "Write the copy" is the noun.
  const docNounText = forDoc.replace(/^copy\b/i, "    ");
  const found: { kind: StepSuggestKind; at: number; label: string }[] = [];
  const add = (kind: StepSuggestKind, i: number, label: string) => { if (i >= 0) found.push({ kind, at: i, label }); };

  const textAt = at(TEXT_WORD, raw);
  const emailWordAt = at(EMAIL_WORD, raw);
  const emailSoftAt = at(EMAIL_SOFT, raw);
  // "Send Ryan a text" is the text; only "email" itself adds the email then.
  const emailAt = emailWordAt >= 0 ? emailWordAt : textAt >= 0 ? -1 : emailSoftAt;
  add("email", emailAt, `Email ${firstName}`);
  add("text", textAt, `Text ${firstName}`);

  const noun = DOC_NOUN.exec(docNounText);
  const docWordAt = at(DOC_WORD, forDoc);
  const docAt = noun ? (docWordAt >= 0 ? Math.min(noun.index, docWordAt) : noun.index) : docWordAt;
  add("doc", docAt, noun ? `Write the ${noun[1].toLowerCase()}` : "Write the document");

  const pageAt = at(PAGE_WORD, raw);
  const videoAt = at(VIDEO_WORD, raw);
  // "Design the landing page" is the page; "design" alone is an image.
  const imageAt = at(IMAGE_WORD, raw);
  const designAt = pageAt < 0 && videoAt < 0 ? at(DESIGN_WORD, raw) : -1;
  add("image", imageAt >= 0 ? imageAt : designAt, "Make the image");
  add("page", pageAt, "Make the web page");
  add("video", videoAt, "Make the video");
  add("checklist", at(CHECKLIST_WORD, raw), "Add a checklist");

  return found.sort((a, b) => a.at - b.at).slice(0, 2).map(({ kind, label }) => ({ kind, label }));
}
