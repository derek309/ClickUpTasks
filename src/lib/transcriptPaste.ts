// A meeting's transcript added by hand (Derek, 2026-10-15: "If it can't find
// the Granola transcript, how can I add it manually?"). When Granola finds
// nothing, isn't connected or fails, the step opens a box to paste it or drop
// the file. Pasted text is filed the way Granola's is (granolaSyncServer
// fileTextTranscript): a text file held on the step, which finishes it. A
// dropped file goes up the task's own upload path and is held the same way.
// Shared by the box, the drawer and the route, so no server imports here.
import type { Subtask } from "./data";

/** Pasted text, at most: a long meeting is a few hundred KB. */
export const TRANSCRIPT_MAX_BYTES = 2 * 1024 * 1024;
export const TRANSCRIPT_FILE_TYPES = [".txt", ".vtt", ".srt", ".docx", ".pdf", ".md"];
/** The file picker's accept list. */
export const TRANSCRIPT_ACCEPT = TRANSCRIPT_FILE_TYPES.join(",");

export const textBytes = (s: string) => new TextEncoder().encode(s).length;

export function isTranscriptFile(name: string): boolean {
  const n = name.toLowerCase();
  return TRANSCRIPT_FILE_TYPES.some((ext) => n.endsWith(ext));
}

/** What the step is called by the meeting it is about: the step's own name,
 *  unless it is the stock "Add the meeting transcript", then the meeting
 *  step it follows ("Meet with Pam"), else the task's name. */
export function transcriptNameFor(step: Pick<Subtask, "id" | "title" | "addedFor">, subtasks: Pick<Subtask, "id" | "title" | "addedFor">[], taskTitle: string): string {
  const own = step.title.trim();
  if (own && step.addedFor !== "transcript" && !/^add the meeting transcript$/i.test(own)) return own;
  const at = subtasks.findIndex((x) => x.id === step.id);
  const meeting = subtasks.slice(0, at < 0 ? subtasks.length : at).reverse().find((x) => x.addedFor === "meeting");
  return meeting?.title.trim() || taskTitle.trim() || "Meeting";
}

/** "Transcript · Meet with Pam · 2026-10-15.txt". The name is kept to one
 *  line of plain words: no slashes or characters a file can't hold. */
export function transcriptFileName(name: string, day: string): string {
  const clean = name.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim() || "Meeting";
  return `Transcript · ${clean} · ${day}.txt`;
}

/** The storage key's part for a file name: storage takes plain letters only. */
export function storageSafeName(name: string): string {
  return name.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-(?=\.)/g, "");
}

/** A recording link as typed: a bare "zoom.us/rec/…" gets https://. Null
 *  when it isn't a web address. */
export function recordingUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const href = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  if (href.length > 2000 || /\s/.test(href)) return null;
  try {
    const u = new URL(href);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? href : null;
  } catch { return null; }
}

export type TranscriptSave = {
  stepId: string;
  /** The name the file is called by (transcriptNameFor). */
  name: string;
  /** Pasted text, kept exactly as pasted. */
  text?: string;
  /** A file already uploaded to the task, the transcript instead of text. */
  attachmentId?: string;
  /** The recording, a link on the step named "Recording". */
  link?: string;
};

/** What Save sends, or null when nothing was entered (no text, no file): the
 *  box then closes having added nothing. */
export function transcriptSavePayload(input: { stepId: string; name: string; text: string; attachmentId?: string | null; link: string }): TranscriptSave | null {
  const hasText = input.text.trim().length > 0;
  if (!hasText && !input.attachmentId) return null;
  const link = recordingUrl(input.link);
  return {
    stepId: input.stepId,
    name: input.name,
    ...(hasText ? { text: input.text } : {}),
    ...(!hasText && input.attachmentId ? { attachmentId: input.attachmentId } : {}),
    ...(link ? { link } : {}),
  };
}

/** The route's check of what came in. */
export function checkTranscriptSave(body: unknown): { ok: true; value: TranscriptSave } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const stepId = typeof b.stepId === "string" ? b.stepId.trim() : "";
  if (!stepId || stepId.length > 64) return { ok: false, error: "Which step is it for?" };
  const name = typeof b.name === "string" ? b.name.slice(0, 200) : "";
  const text = typeof b.text === "string" && b.text.trim() ? b.text : undefined;
  const attachmentId = typeof b.attachmentId === "string" && /^[\w-]{1,64}$/.test(b.attachmentId) ? b.attachmentId : undefined;
  if (!text && !attachmentId) return { ok: false, error: "Paste the transcript or drop the file first." };
  if (text && textBytes(text) > TRANSCRIPT_MAX_BYTES) return { ok: false, error: "That transcript is over 2 MB. Drop it as a file instead." };
  let link: string | undefined;
  if (typeof b.link === "string" && b.link.trim()) {
    const ok = recordingUrl(b.link);
    if (!ok) return { ok: false, error: "The recording link isn't a web address." };
    link = ok;
  }
  return { ok: true, value: { stepId, name, ...(text ? { text } : {}), ...(attachmentId && !text ? { attachmentId } : {}), ...(link ? { link } : {}) } };
}

/** The box's one line under its heading: why it opened. */
export function transcriptBoxReason(r: { error?: string | null; connect?: boolean; skipped?: boolean }): string {
  if (r.skipped) return "Paste it or drop the file.";
  if (r.error) return `${r.error.replace(/[.\s]+$/, "")}. Paste it or drop the file.`;
  if (r.connect) return "Granola isn't connected. Paste it or drop the file.";
  return "Granola didn't find this meeting. Paste it or drop the file.";
}
