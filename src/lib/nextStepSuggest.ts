// The next step a "what's next?" step's context points to (Derek, 2026-10-14:
// MEDAL of brands knew his original ask, "put it in the Bulk customers blast",
// and still highlighted "The task is finished"). Pure: words only. The rule
// here is the fallback; the server asks the app's AI once and keeps its answer
// on the step (suggested), see /api/tasks/[id]/next-step.

const VERBS = "put|send|schedule|post|publish|add|build|make|write|create|email|update|share|set up|book|call|text|upload|launch|run|order|print|design|draft|finish|fix|move|plan";
const LEAD = new RegExp(`^(?:please\\s+)?(?:${VERBS})\\b`, "i");

const sentences = (text: string) => text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const tidy = (s: string) => {
  const t = s.replace(/^[\s"'“”:,-]+|[\s"'“”.!?,;:]+$/g, "").replace(/^please\s+/i, "").replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  const cut = words.length > 12 ? words.slice(0, 12).join(" ") : t;
  return cut ? cut.charAt(0).toUpperCase() + cut.slice(1) : "";
};

/** One next step's name from the context text, or null when it asks nothing:
 *  an "ask:" / "next:" / "then:" line first, then "wants us to …", then the
 *  last sentence that starts with a doing word. */
export function nextStepFromContext(text: string | null | undefined): string | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const labelled = /\b(?:original ask|ask|asked for|next(?: step)?|then|to do)\s*:\s*([^\n.!?]+)/i.exec(raw);
  if (labelled && tidy(labelled[1])) return tidy(labelled[1]);
  const wants = /\b(?:wants|asked|needs)\s+(?:us|me|you|them|it)?\s*to\s+([^\n.!?]+)/i.exec(raw);
  if (wants && tidy(wants[1])) return tidy(wants[1]);
  const lead = sentences(raw).filter((s) => LEAD.test(s)).pop();
  return lead ? tidy(lead) || null : null;
}

/** The text a "what's next?" step reads for its suggestion: its own notes, the
 *  step before it (its directions and name), and the task's description, the
 *  closest first. */
export function whatsNextContext(parts: { notes?: string | null; prevNotes?: string | null; prevTitle?: string | null; description?: string | null }): string {
  return [parts.notes, parts.prevNotes, parts.description].map((x) => (x ?? "").trim()).filter(Boolean).join("\n\n");
}

const STOP = new Set(["the", "and", "for", "with", "this", "that", "into", "onto", "from", "your", "their", "them", "they", "will", "have", "has", "was", "were", "are", "our", "out", "put", "send", "make", "add", "it", "its", "his", "her", "him", "she", "about", "what", "next", "step", "task", "approved", "version", "email", "derek", "marked", "original", "ask", "by", "to", "of", "in", "on", "a", "an"]);
/** The words that say what something is about: lower case, no small or
 *  common words, a plural as its singular ("customers" is "customer"). */
export function significantWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .map((w) => w.replace(/'s$/, "").replace(/(?<=[a-z]{3})s$/, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w)));
}

/** An open task on the same client that the ask is already about (Derek,
 *  2026-10-14: "put it in the Bulk customers blast", and "Bulk Customers
 *  Newsletter" was due tomorrow on Brian's Bulk list): the one sharing the
 *  most significant words, at least two, never this task or a finished one. */
export function taskForAsk<T extends { id: string; title: string; clientId: string; status: string }>(ask: string, tasks: T[], self: { id: string; clientId: string }): T | null {
  const want = significantWords(ask);
  if (want.size < 2) return null;
  let best: { t: T; n: number } | null = null;
  for (const t of tasks) {
    if (t.id === self.id || t.clientId !== self.clientId || t.status === "done") continue;
    const n = [...significantWords(t.title)].filter((w) => want.has(w)).length;
    if (n >= 2 && (!best || n > best.n)) best = { t, n };
  }
  return best?.t ?? null;
}
