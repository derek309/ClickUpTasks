/** A report from the website feedback plugin (cul-feedback), which files tasks
 *  through POST /api/extension/tasks. Its text is the client's edit and note,
 *  then a "---" line and where it came from (page, element, screen, browser),
 *  for the team. The plugin says "Reported from the website" in that part on
 *  every report; a later plugin can say source: "website_feedback" outright.
 *
 *  The client's own words are saved the way a portal request is (client
 *  response plus a chat message), so their portal shows them as theirs, and
 *  the whole report is step 1's directions for the team (Derek, 2026-10-14). */
export const WEBSITE_FEEDBACK = "website_feedback" as const;

export function isWebsiteFeedbackReport(text: string, source?: unknown): boolean {
  if (source === WEBSITE_FEEDBACK) return true;
  return /^---$/m.test(text) && /^Reported from the website\b/m.test(text);
}

/** What the client wrote: everything before the "---" line. The whole text
 *  when there is no such line. */
export function clientWordsOfReport(text: string): string {
  const cut = text.replace(/\r\n/g, "\n").split(/\n*^---$/m)[0].trim();
  return cut || text.trim();
}
