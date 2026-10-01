// The prompt and clean up behind Improve with AI (api/ai/improve).

export function improvePrompt(text: string, channel: "email" | "sms" | "chat"): string {
  return [
    "Fix the spelling, grammar, capitalization and punctuation of the message below.",
    "Keep the writer's own words, tone and meaning. Do not add, remove or reorder ideas, do not add a greeting or sign off, and do not make it more formal.",
    "Never use em dashes or en dashes; use a comma or a period instead.",
    channel === "sms" ? "It is a text message: keep it short and casual." : "Keep the line breaks and paragraphs as they are.",
    "Reply with the corrected message only: no quotes, no notes, no preamble.",
    "",
    "MESSAGE:",
    text,
  ].join("\n");
}

/** Model output, made safe to drop into the reply box. */
export function cleanImproved(out: string): string {
  return out
    .replace(/^\s*(MESSAGE|Corrected message):\s*/i, "")
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/\s*[—–]\s*/g, ", ")
    .trim();
}
