/** What a step's name says it needs, read as one of the step's Add menu items
 *  (Derek, 2026-10-13: an empty "Create plan and send to Ryan" should offer
 *  "Write the plan", not a bare + Add).
 *
 *  One thing per step (Derek, 2026-10-14): only the first thing the name
 *  points to. "Create newsletter" builds the HTML review; emailing it to the
 *  client is picked from What's next once the step is done.
 *
 *  Pure: words in the title only. The step page shows it as a button that does
 *  what picking the same item from + Add does, and hides it once the step
 *  holds that kind of work. A call needs nothing made, so it suggests nothing. */
export type StepSuggestKind = "email" | "text" | "doc" | "image" | "page" | "video" | "checklist";
export type StepSuggestion = { kind: StepSuggestKind; label: string };

// "Draft an email", "write a text": the thing written is the message, not a document.
const MESSAGE_WRITING = /\b(?:write|draft)\s+(?:(?:an?|the|a quick)\s+)?(?:email|e-mail|text|reply|message|note)s?\b/gi;
const WRITE_TO = /\bwrite\s+(?:to|back)\b/gi;

const EMAIL_WORD = /\b(?:email|e-mail|emails)\b/i;
// A newsletter goes to subscribers from GoHighLevel, not to the client, so it
// is the HTML review only: "Send the newsletter" is not an email to them
// (Derek, 2026-10-14).
const NEWSLETTER = /\bnewsletters?\b/i;
// Soft: these give way to a text ("Reply by text" is the text, not an email).
const EMAIL_SOFT = /\b(?:send|reply|tell|write\s+(?:to|back)|follow[\s-]?up|follow[\s-]?ups|remind|reminder|reminders)\b|\blet\b.{0,40}?\bknow\b/i;
// Mass sends go to the client's own customers from GoHighLevel, built as an
// HTML review, never an email to the client (Derek, 2026-10-14: "Schedule
// Campaign to bulk customers" offered "Email Brian").
const MASS = /\b(?:campaigns?|blasts?|newsletters?|bulk)\b/i;
/** A send to the client's own customers (a campaign, blast, newsletter or
 *  bulk send), never an email to the client. */
export const isMassSend = (title: string) => MASS.test(title ?? "");
const TEXT_WORD = /\b(?:text|texts|sms)\b/i;
const DOC_NOUN = /\b(plan|proposal|brief|copy)\b/i;
const DOC_WORD = /\b(?:write|draft|document|doc|post|posts|blog|blogs|article|articles)\b/i;
// "ad" only as a word: "add" and "address" stay out.
const IMAGE_WORD = /\b(image|images|graphic|graphics|thumbnail|thumbnails|flyer|flyers|flier|fliers|postcard|postcards|banner|banners|ad|ads)\b/i;
const DESIGN_WORD = /\b(design)\b/i;
const PAGE_WORD = /\b(?:page|pages|landing|site|sites|website|websites|webpage|newsletter|newsletters|campaign|campaigns|blast|blasts)\b/i;
const VIDEO_WORD = /\b(video|videos|reel|reels|clip|clips)\b/i;
const CHECKLIST_WORD = /\b(?:checklist|list)\b/i;

const at = (re: RegExp, s: string) => { const m = re.exec(s); return m ? m.index : -1; };

// "Make the flyers" reads as the one flyer; "ads" is "ad".
const singular = (w: string) => w.toLowerCase().replace(/s$/, "");

/** The one Add menu item the step's name points to first, or none.
 *  firstName is the client's, as clientFirstName gives it. */
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
  // A mass send ("Schedule email to bulk customers", "Holiday campaign") is
  // never an email to the client; only words naming them make one ("email
  // Brian", "reply to Brian", "send Brian", "let Brian know").
  const mass = MASS.test(raw);
  const who = firstName.trim() ? firstName.trim().split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const toClient = who ? new RegExp(`\\b(?:email|e-mail|reply\\s+to|send|write\\s+to|let)\\s+${who}\\b`, "i").exec(raw) : null;
  const emailWordAt = mass ? -1 : at(EMAIL_WORD, raw);
  // "Send the newsletter" sends nothing to the client: no soft email then.
  const emailSoftAt = NEWSLETTER.test(raw) || mass ? -1 : at(EMAIL_SOFT, raw);
  // "Send Ryan a text" is the text; only "email" itself adds the email then.
  const emailAt = mass ? (toClient && textAt < 0 ? toClient.index : -1) : emailWordAt >= 0 ? emailWordAt : textAt >= 0 ? -1 : emailSoftAt;
  add("email", emailAt, `Email ${firstName}`);
  add("text", textAt, `Text ${firstName}`);

  const noun = DOC_NOUN.exec(docNounText);
  const docWordAt = at(DOC_WORD, forDoc);
  const docAt = noun ? (docWordAt >= 0 ? Math.min(noun.index, docWordAt) : noun.index) : docWordAt;
  add("doc", docAt, noun ? `Write the ${noun[1].toLowerCase()}` : "Write the document");

  const pageAt = at(PAGE_WORD, raw);
  const video = VIDEO_WORD.exec(raw);
  // "Design the landing page" is the page; "design" alone is an image.
  const image = IMAGE_WORD.exec(raw) ?? (pageAt < 0 && !video ? DESIGN_WORD.exec(raw) : null);
  if (image) add("image", image.index, `Make the ${singular(image[1])}`);
  add("page", pageAt, "Build the HTML review");
  if (video) add("video", video.index, `Make the ${singular(video[1])}`);
  add("checklist", at(CHECKLIST_WORD, raw), "Add a checklist");

  return found.sort((a, b) => a.at - b.at).slice(0, 1).map(({ kind, label }) => ({ kind, label }));
}
