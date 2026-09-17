// SERVER ONLY. A review's name, given by AI the first time it has something in it
// (Derek, 2026-09-13: "have ai rename the titles for doc, images and html so it's
// not generic"). Until then a review goes by "New document" / "New image review" /
// "New HTML review" for the team and the task's title for the client.
//
// His rules: it names a review once, when it first gets content (a document with
// words in it, the first image, the first page) and then leaves it alone; for an
// image it may look at the picture, read only, along with the task's title; and it
// never touches a name someone typed. So it only runs while the title is blank and
// ai_named_at is empty (supabase/task-review-ai-names.sql), marks ai_named_at even
// when Gemini has no usable answer (one try, not one per save), and writes with both
// in the filter, so a name typed in the meantime always wins. Nothing here can fail
// a save or an upload: any problem just leaves the review unnamed.
import { supabaseAdmin } from "./supabaseAdmin";
import { TASK_FILES_BUCKET } from "./db";
import { htmlToText } from "./data";
import { pageText } from "./pageHtml";
import type { ReviewKind } from "./reviewKinds";

const GEMINI_MODEL = "gemini-flash-latest";
// Inside the save's own request, so the answer already carries the name. Once only.
const GEMINI_TIMEOUT_MS = 8000;
/** A document is named once it has this many words, not on its first keystrokes. */
export const NAME_MIN_WORDS = 12;
const MAX_TEXT_CHARS = 4000;
// Bigger images are named from the task title and file name alone.
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_NAME_CHARS = 60;

export type NameSource =
  | { kind: "doc"; html: string }
  | { kind: "image" | "page" | "video"; path: string; fileName: string };

type Row = Record<string, unknown>;

// What a review would be called anyway: never worth a name.
const GENERIC = /^(new |untitled |the |a |an )*(client )?(document|doc|image|picture|photo|page|web page|html|html review|image review|review|email|file|draft|untitled)s?$/i;

/** Gemini's answer as a name: one line, no quotes, labels, dashes or end punctuation,
 *  at most 60 characters cut at a word. Null when nothing specific is left. */
export function cleanReviewName(raw: string): string | null {
  let name = (raw.split("\n").find((line) => line.trim()) ?? "")
    .replace(/^\s*(name|title)\s*:\s*/i, "")
    .replace(/[*_`"“”‘’]/g, "")
    .replace(/\s*[-–—‐‑‒―]+\s*/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .replace(/[.,:;!?]+$/, "")
    .trim();
  if (name.length > MAX_NAME_CHARS) {
    const cut = name.slice(0, MAX_NAME_CHARS + 1);
    name = (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut.slice(0, MAX_NAME_CHARS)).trim();
  }
  return name.length >= 2 && !GENERIC.test(name) ? name : null;
}

/** Whether this review still goes by its default name and has never been named by AI.
 *  A row without ai_named_at (the column not added yet) is never named. */
export const awaitsName = (doc: Row): boolean =>
  "ai_named_at" in doc && doc.ai_named_at == null && typeof doc.title === "string" && !doc.title.trim();

const KIND_WORDS: Record<ReviewKind, string> = {
  doc: "a text document",
  image: "an image (a graphic, flyer, ad, social post, logo or photo)",
  page: "a web page or an HTML email",
  // Named from its file name and task alone, so the prompt leans on those.
  video: "a video (go by the file name and the task, which is all there is here)",
};

export function buildNamePrompt(kind: ReviewKind, taskTitle: string, fileName: string | null, content: string | null): string {
  return [
    "You name a piece of client work in a project management tool, so the team can tell it apart at a glance.",
    `It is ${KIND_WORDS[kind]} the team is sending a client to review.`,
    "Write one short, specific name for it: 2 to 6 words, under 60 characters, in title case.",
    "Say what it is about, for example Fall Open House Flyer or September Newsletter Email. Go by the content first and use the task title only as a hint.",
    "Never use quotes, dashes, emoji or ending punctuation. Never answer with a generic name like Document, Image, Review or New Page.",
    "Answer with the name only.",
    "",
    `Task title: ${taskTitle}`,
    fileName ? `File name: ${fileName}` : null,
    content ? `Content:\n${content.slice(0, MAX_TEXT_CHARS)}` : kind === "image" ? "The image is attached." : null,
  ].filter((line) => line !== null).join("\n");
}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** What Gemini reads about the review: the words, the page's words and title, or
 *  the image itself. A video is named from its file name and the task alone: the
 *  file is hundreds of megabytes and pulling it into a function to look at one
 *  frame would cost more than the name is worth. */
async function contentParts(source: NameSource, taskTitle: string): Promise<Part[] | null> {
  if (source.kind === "doc") {
    const text = htmlToText(source.html).trim();
    if (text.split(/\s+/).filter(Boolean).length < NAME_MIN_WORDS) return null;
    return [{ text: buildNamePrompt("doc", taskTitle, null, text) }];
  }
  // Before the download, deliberately.
  if (source.kind === "video") return [{ text: buildNamePrompt("video", taskTitle, source.fileName, null) }];
  const { data: blob } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).download(source.path);
  if (source.kind === "page") {
    const html = blob ? await blob.text() : "";
    const pageTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    const text = [pageTitle ? `Page title: ${pageTitle}` : null, pageText(html)].filter(Boolean).join("\n");
    return [{ text: buildNamePrompt("page", taskTitle, source.fileName, text || null) }];
  }
  const type = IMAGE_TYPES[source.fileName.split(".").pop()?.toLowerCase() ?? ""];
  const parts: Part[] = [{ text: buildNamePrompt("image", taskTitle, source.fileName, null) }];
  // Read only: the bytes go to Gemini to look at, and nothing is changed or stored.
  if (blob && type && blob.size <= MAX_IMAGE_BYTES) {
    parts.push({ inline_data: { mime_type: type, data: Buffer.from(await blob.arrayBuffer()).toString("base64") } });
  } else {
    parts[0] = { text: buildNamePrompt("image", taskTitle, source.fileName, "The image itself couldn't be attached; go by the task title and file name.") };
  }
  return parts;
}

async function askGemini(parts: Part[], apiKey: string): Promise<string | null> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // No maxOutputTokens: the model can spend a small cap before it writes a word
    // (it answered MAX_TOKENS with no text at 40). cleanReviewName keeps it short.
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { thinkingConfig: { thinkingBudget: 0 }, temperature: 0.4 } }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? text : null;
}

/** Name the review from its first content when it still goes by its default name.
 *  Returns the updated row, or null when nothing changed (the caller keeps its own). */
export async function nameReviewIfDefault(doc: Row, source: NameSource): Promise<Row | null> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !awaitsName(doc) || typeof doc.id !== "string") return null;
    const { data: task } = await supabaseAdmin.from("tasks").select("title").eq("id", doc.task_id as string).maybeSingle();
    const parts = await contentParts(source, (task?.title as string | undefined) ?? "");
    // A document still too short to name waits for more words, unmarked.
    if (!parts) return null;
    const answer = await askGemini(parts, apiKey).catch(() => null);
    const name = answer ? cleanReviewName(answer) : null;
    const { data } = await supabaseAdmin.from("task_documents")
      .update({ ...(name ? { title: name } : {}), ai_named_at: new Date().toISOString() })
      .eq("id", doc.id).eq("title", "").is("ai_named_at", null)
      .select("*").maybeSingle();
    return name && data ? (data as Row) : null;
  } catch {
    return null;
  }
}
