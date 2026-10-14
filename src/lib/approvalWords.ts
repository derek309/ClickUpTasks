// A client's email that reads as approving the review out with them (Derek,
// 2026-10-14: Brian answered "approved" by email and the review sat open).
// A simple word rule, no AI: short, says yes, asks for nothing else. The app
// only offers "Mark version N approved" on it; a person taps it.

const YES = /\b(?:approved?|approves|looks?\s+(?:good|great|perfect|fine)|good\s+to\s+go|go\s+ahead|green\s+light|ship\s+it|send\s+it|perfect|love\s+it|all\s+good|lgtm|sounds\s+good|ok\s+to\s+(?:send|go|publish)|yes,?\s+(?:please\s+)?(?:send|go|publish|do\s+it))\b/i;
// Anything asking for a change, or a no, is not an approval.
const BUT = /\b(?:but|however|except|change|changes|fix|instead|not|don'?t|isn'?t|wait|hold|before\s+you|can\s+you|could\s+you|please\s+(?:update|change|fix|swap|remove|add)|needs?)\b|\?/i;

/** Whether the client's own words read as an approval. Pass their words
 *  without the quoted thread or signature (clientEmailText). */
export function readsAsApproval(words: string | null | undefined): boolean {
  const t = (words ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 40) return false;
  return YES.test(t) && !BUT.test(t);
}

/** The review an approval by email is for: the one on the step, else the one
 *  out with the client, else the only one not approved yet; null when none,
 *  or when it is not plain which. Only reviews with a version sent. */
export function reviewToApprove<K extends string>(reviews: Partial<Record<K, { status: string; version: number }>>, onStep: K[] = []): K | null {
  const open = (Object.keys(reviews) as K[]).filter((k) => { const r = reviews[k]; return !!r && r.version > 0 && r.status !== "approved" && r.status !== "completed"; });
  const here = onStep.find((k) => open.includes(k));
  if (here) return here;
  const out = open.filter((k) => reviews[k]!.status === "with_client" || reviews[k]!.status === "client_submitted");
  if (out.length === 1) return out[0];
  return open.length === 1 ? open[0] : null;
}
