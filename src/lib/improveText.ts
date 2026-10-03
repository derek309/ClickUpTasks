// The prompt and clean up behind Improve with AI and Shorter (api/ai/improve).

export type ImproveMode = "fix" | "shorter";

export function improvePrompt(text: string, channel: "email" | "sms" | "chat", mode: ImproveMode = "fix", html = false): string {
  return [
    mode === "shorter"
      ? "Make the message below shorter and to the point. Keep every fact, date, ask and link, cut the filler, and keep the writer's own voice. Fix any spelling or grammar on the way."
      : "Fix the spelling, grammar, capitalization and punctuation of the message below.",
    mode === "shorter"
      ? "Do not add new ideas, a greeting or a sign off that is not already there, and do not make it more formal."
      : "Keep the writer's own words, tone and meaning. Do not add, remove or reorder ideas, do not add a greeting or sign off, and do not make it more formal.",
    "Never use em dashes or en dashes; use a comma or a period instead.",
    // The Inbox email box writes HTML (Derek, 2026-10-02: keep the bold and
    // the links through the AI).
    html ? "The message is HTML. Keep its tags: every <a href> with the same address, bold, italic, underline and lists. Change only the words. Reply with HTML only." : null,
    channel === "sms" ? "It is a text message: keep it short and casual." : html ? null : "Keep the line breaks and paragraphs as they are.",
    "Reply with the message only: no quotes, no notes, no preamble.",
    "",
    "MESSAGE:",
    text,
  ].filter((l) => l !== null).join("\n");
}

/** Model output, made safe to drop into the reply box. */
export function cleanImproved(out: string): string {
  return out
    .replace(/^\s*```(?:html)?\s*/i, "").replace(/\s*```\s*$/, "")
    .replace(/^\s*(MESSAGE|Corrected message|Shorter message):\s*/i, "")
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/\s*[—–]\s*/g, ", ")
    .trim();
}

/** Draft a reply: the conversation, newest last, and the linked task. */
export function draftReplyPrompt(o: { me: string | null; them: string | null; conversation: string; task: string | null }): string {
  return [
    `Write a reply email${o.me ? ` from ${o.me}` : ""}${o.them ? ` to ${o.them}` : ""}, answering the newest message from them in the conversation below.`,
    "Sound like a friendly small business owner: plain, warm, short. Two or three short paragraphs at most.",
    "Start with a short greeting using their first name. Do not add a sign off or a name at the end; the signature is added on its own.",
    "Use only facts from the conversation and the task. Never invent dates, prices or promises. Where you would need something you don't know, write [ADD: what is needed] for the writer to fill in.",
    "Never write a web address. Never use em dashes or en dashes.",
    "Reply with the email text only, paragraphs separated by a blank line: no subject, no quotes, no notes.",
    "",
    "CONVERSATION:",
    o.conversation,
    o.task ? "" : null,
    o.task ? "THE TASK THIS IS ABOUT (background, not to paste):" : null,
    o.task,
  ].filter((l) => l !== null).join("\n");
}
