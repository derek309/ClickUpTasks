// How every client email is written (Derek, 2026-10-12: "it's producing really
// long email drafts... be very clear what we need and not over explain;
// include links for them to review; always end with what we need from them
// and how to get it to us; no signature"). Used by Write with AI, the Inbox's
// AI reply, and (word for word, in mcp/core.mjs) Claude's draft tools.
export const EMAIL_FORMAT = [
  "Keep it short: about 60 to 120 words. Plain, friendly, no filler, no over explaining.",
  "Shape: a greeting with their first name; one line on why you are writing; only the facts they need, as short bullet points when there is more than one; then, last, the ask.",
  "Where they should look at something, give them the link to it.",
  "Always end with exactly what we need from them, by when if there is a date, and how to get it to us (for example: just reply to this email with it).",
  "No sign off and no name at the end: the signature is added on its own. Never use em dashes or en dashes.",
];

/** A "Thanks, / Derek" (or Best, Cheers...) left at the end of a draft comes
 *  off: the signature is added on its own. */
export function stripSignOff(text: string): string {
  return text.replace(/(\n\s*)+(thanks( again| so much)?|thank you|many thanks|best( regards)?|kind regards|warm regards|regards|cheers|talk soon|warmly|sincerely)[,.!]?\s*(\n+\s*[A-Z][\w.' -]{0,40})?\s*$/i, "").trimEnd();
}
