// Shared by the server and both review pages: the two kinds of HTML review
// (Derek, 2026-10-15, html-review-mockup.html). An Email review and a Page
// review are the same review underneath (kind "page" in reviewKinds.ts); which
// one it is, and the fields on top of it, live in task_documents.picks.meta, the
// one jsonb on the row, so no column is needed:
//   pageKind      "email" or "page"; a review made before this has none, and
//                 its name decides (a newsletter or an email is an email)
//   subject       an email's subject line, and previewText the line an inbox
//                 shows under it
//   pageTitle     a page's title, description its Google description and slug
//                 its address
// Also here: the status sentence at the top of the review, the one dark button
// that follows the turn, and the new words a client is shown on version 2.
import { diffText } from "./docDiff";

export type PageKind = "email" | "page";
export type ReviewMeta = {
  pageKind?: PageKind;
  subject?: string;
  previewText?: string;
  pageTitle?: string;
  description?: string;
  slug?: string;
};

/** The step actions that make one: both are an HTML review (holds "page") with its kind set. */
export const PAGE_ACTIONS = { email: "page:email", page: "page:page" } as const;
export type PageAction = (typeof PAGE_ACTIONS)[PageKind];
/** The kind an action key makes, or null when it is not one of the two. */
export const pageKindOfAction = (key: string | null | undefined): PageKind | null =>
  key === PAGE_ACTIONS.email ? "email" : key === PAGE_ACTIONS.page ? "page" : null;
export const isPageAction = (key: string | null | undefined): key is PageAction => pageKindOfAction(key) !== null;
/** The action key for a kind. */
export const pageAction = (kind: PageKind): PageAction => PAGE_ACTIONS[kind];

const EMAIL_NAME = /\b(news\s?letters?|e-?mails?|e-?blasts?)\b/i;
/** A review with no kind stored goes by its name: a newsletter or an email is an
 *  email review, anything else a page review. */
export const pageKindFromName = (name: string | null | undefined): PageKind => (EMAIL_NAME.test(name ?? "") ? "email" : "page");
/** The kind stored, else the one its name says. */
export const pageKindOf = (meta: ReviewMeta | null | undefined, name: string | null | undefined): PageKind =>
  meta?.pageKind ?? pageKindFromName(name);
export const pageKindLabel = (kind: PageKind) => (kind === "email" ? "Email review" : "Page review");
/** Inside a sentence: "Delete this email review?" */
export const pageKindInSentence = (kind: PageKind) => (kind === "email" ? "email review" : "page review");
export const pageKindNewName = (kind: PageKind) => (kind === "email" ? "New email review" : "New page review");

const LIMITS: Record<Exclude<keyof ReviewMeta, "pageKind">, number> = { subject: 200, previewText: 300, pageTitle: 200, description: 320, slug: 120 };
const oneLine = (s: string, max: number) => s.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** An address as a slug: lower case words joined, nothing else. */
export const cleanSlug = (s: string) => s.toLowerCase().replace(/^https?:\/\/[^/]+/, "").replace(/[^a-z0-9/]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-/]+|[-]+$/g, "").slice(0, LIMITS.slug);

/** The meta kept on a review's row (picks.meta), each field checked again. */
export function readReviewMeta(picks: unknown): ReviewMeta {
  const raw = picks && typeof picks === "object" ? (picks as { meta?: unknown }).meta : null;
  return raw && typeof raw === "object" ? cleanReviewMeta(raw) : {};
}

/** Only the known fields, trimmed to size; anything else is dropped. A field set
 *  to "" stays "" so a cleared one can be saved. */
export function cleanReviewMeta(input: unknown): ReviewMeta {
  if (!input || typeof input !== "object") return {};
  const r = input as Record<string, unknown>;
  const out: ReviewMeta = {};
  if (r.pageKind === "email" || r.pageKind === "page") out.pageKind = r.pageKind;
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const v = r[key];
    if (typeof v !== "string") continue;
    out[key] = key === "slug" ? cleanSlug(v) : oneLine(v, LIMITS[key]);
  }
  return out;
}

/** The row's picks with this meta merged in; the option chosen stays as it was. */
export function withReviewMeta(picks: unknown, change: ReviewMeta): Record<string, unknown> {
  const base = picks && typeof picks === "object" ? { ...(picks as Record<string, unknown>) } : {};
  return { ...base, meta: { ...readReviewMeta(base), ...cleanReviewMeta(change) } };
}

/** The picks with the option chosen (or none), keeping the meta. */
export function withPick(picks: unknown, pick: { fileId: string; by: "team" | "client"; at: string } | null): Record<string, unknown> {
  const meta = readReviewMeta(picks);
  return { ...(pick ?? {}), ...(Object.keys(meta).length ? { meta } : {}) };
}

// ── The status sentence and the one button ─────────────────────────────────

export type ReviewStatus = "draft" | "with_client" | "client_submitted" | "approved" | "completed";
export type TurnState = "draft" | "client" | "changes" | "approved" | "completed";
export type TurnInput = {
  status: ReviewStatus;
  /** Versions sent to the client so far. */
  sent: number;
  /** A version is ready that the client has not seen (not sent yet, or changed since). */
  needsSend: boolean;
  /** The client's first name. */
  first: string;
  /** Changes the client sent on the last version: their open comments. */
  changes: number;
  /** The client's waiting step's due date (YYYY-MM-DD), if it has one. */
  needBy?: string | null;
  approvedAt?: string | null;
  /** True when the team marked it approved on the client's say so. */
  approvedByTeam?: boolean;
  kind: PageKind;
};
export type Turn = {
  state: TurnState;
  /** The words before the rest, said as the step's sentence says them ("Your turn"). */
  who: string;
  /** The rest of the sentence, starting with its own comma or colon. */
  rest: string;
  /** The dot's colour: red is ours, amber the client's, green approved. */
  dot: "ours" | "theirs" | "approved";
  /** The one dark button, or null when nothing is ours to press. */
  button: { label: string; action: "send" | "schedule" | "done" } | null;
};

/** "Fri, Oct 17" from a date or a time. */
export function shortDay(value: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
const monthDay = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/** Where the review stands, for the team: whose turn, the sentence and the button. */
export function htmlReviewTurn(t: TurnInput): Turn {
  const first = t.first.trim() || "the client";
  const next = t.sent + 1;
  if (t.status === "completed") {
    return { state: "completed", who: "Done", rest: `, version ${Math.max(1, t.sent)}`, dot: "approved", button: null };
  }
  if (t.status === "approved") {
    const when = t.approvedAt ? `, ${monthDay(t.approvedAt)}` : "";
    return {
      state: "approved", who: t.approvedByTeam ? `Approved for ${first}` : `Approved by ${first}`, rest: when, dot: "approved",
      button: t.kind === "email" ? { label: "Schedule it", action: "schedule" } : { label: "Done", action: "done" },
    };
  }
  if (t.status === "client_submitted") {
    const what = t.changes > 0 ? `${t.changes} ${t.changes === 1 ? "change" : "changes"}` : "changes";
    return { state: "changes", who: "Your turn", rest: `: ${first} sent ${what} on version ${Math.max(1, t.sent)}`, dot: "ours", button: { label: `Send version ${next} to ${first}`, action: "send" } };
  }
  if (t.status === "with_client" && !t.needsSend) {
    return { state: "client", who: `${first}'s turn`, rest: `, version ${Math.max(1, t.sent)}${t.needBy ? `, need by ${shortDay(t.needBy)}` : ""}`, dot: "theirs", button: null };
  }
  return {
    state: "draft", who: "Your turn", rest: `, version ${next}, not sent yet`, dot: "ours",
    button: { label: t.sent === 0 ? `Send to ${first} for review` : `Send version ${next} to ${first}`, action: "send" },
  };
}

/** The same, as the client reads it on their review page. */
export function clientTurnSentence(t: { status: ReviewStatus; version: number; changes: number; needBy?: string | null; approvedAt?: string | null; closed?: boolean }): { who: string; rest: string; dot: Turn["dot"] } {
  if (t.status === "approved") return { who: "Approved by you", rest: t.approvedAt ? `, ${monthDay(t.approvedAt)}` : "", dot: "approved" };
  if (t.status === "completed" || t.closed) return { who: "Done", rest: `, version ${Math.max(1, t.version)}`, dot: "approved" };
  if (t.status === "client_submitted") {
    const what = t.changes > 0 ? `${t.changes} ${t.changes === 1 ? "change" : "changes"}` : "changes";
    return { who: "Our turn", rest: `: you sent ${what} on version ${Math.max(1, t.version)}`, dot: "theirs" };
  }
  return { who: "Your turn", rest: `, version ${Math.max(1, t.version)}${t.needBy ? `, need by ${shortDay(t.needBy)}` : ""}`, dot: "ours" };
}

// ── What changed since the client last looked ──────────────────────────────

const MIN_PHRASE = 3;
const MAX_PHRASE = 300;
const MAX_PHRASES = 60;
/** The words added between two versions' text, as phrases to find on the page
 *  and highlight. Line by line, so a phrase never runs across two blocks of
 *  the page. Empty when nothing was added, or when the diff fails. */
export function addedPhrases(before: string, after: string): string[] {
  if (!after.trim() || before === after) return [];
  try {
    const out: string[] = [];
    for (const part of diffText(before, after)) {
      if (part.type !== "added") continue;
      for (const line of part.text.split(/\n+/)) {
        const phrase = line.replace(/\s+/g, " ").trim();
        if (phrase.replace(/[^\p{L}\p{N}]/gu, "").length < MIN_PHRASE) continue;
        const cut = phrase.slice(0, MAX_PHRASE);
        if (!out.includes(cut)) out.push(cut);
        if (out.length >= MAX_PHRASES) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}
