// Shared by the server and both review pages: the kinds of client review
// document a task can have, and what each is called. One place, so a new kind is
// one line here rather than a string choice in every file.
//   doc    the text document the team writes (supabase/task-documents.sql)
//   image  an image the client pins comments to (supabase/task-image-reviews.sql)
//   page   a web page, uploaded .html or pasted code, the client pins comments to
//          and can reword (supabase/task-page-reviews.sql)
//   video  a video the client watches and pauses to comment on
//          (supabase/task-video-reviews.sql)
// image, page and video are "file kinds": their body and every version body hold
// the id of a file, not HTML.

export type ReviewKind = "doc" | "image" | "page" | "video";
export type FileKind = Exclude<ReviewKind, "doc">;

/** Any value (a query string, a row) as a kind; anything unknown is the text document. */
export const parseKind = (raw: unknown): ReviewKind =>
  (raw === "image" || raw === "page" || raw === "video" ? raw : "doc");

/** Whether the kind's body is a file id rather than HTML. */
export const isFileKind = (kind: ReviewKind): kind is FileKind => kind !== "doc";

/** The purpose its version files are stored under in task_document_files. */
export const filePurpose = (kind: FileKind): FileKind => kind;

const WHAT: Record<ReviewKind, string> = { doc: "document", image: "image", page: "page", video: "video" };
// The team calls the page kind an "HTML review" (Derek, 2026-09-13); what the client
// sees still says "page".
const TITLE: Record<ReviewKind, string> = { doc: "Client document", image: "Image review", page: "HTML review", video: "Video review" };
const NEW_NAME: Record<ReviewKind, string> = { doc: "New document", image: "New image review", page: "New HTML review", video: "New video review" };
/** The title inside a sentence (lowercasing would spoil "HTML"). */
const IN_SENTENCE: Record<ReviewKind, string> = { doc: "client document", image: "image review", page: "HTML review", video: "video review" };

/** The short word the client reads: "This image is approved." */
export const kindWhat = (kind: ReviewKind) => WHAT[kind];
/** What the team's activity lines and notifications call it, the name the team
 *  uses everywhere else: "approved the HTML review". */
export const kindNoun = (kind: ReviewKind) => IN_SENTENCE[kind];
/** Its name on the task: "HTML review". */
export const kindTitle = (kind: ReviewKind) => TITLE[kind];
/** Its row's name on the team's task until someone names it, so a task's document,
 *  image and page reviews don't all read as the task's own title (Derek,
 *  2026-09-13). The client still sees the task's title. */
export const kindNewName = (kind: ReviewKind) => NEW_NAME[kind];
/** Its name inside a sentence: "Delete this HTML review?" */
export const kindInSentence = (kind: ReviewKind) => IN_SENTENCE[kind];
export const noDocumentYet = (kind: ReviewKind) => `This task has no ${IN_SENTENCE[kind]} yet.`;
/** The comment box's hint, one shape for every kind (Derek, 2026-09-13: image and
 *  HTML reviews "need to be the same as doc"). */
export const commentHint = (kind: ReviewKind) => kind === "doc"
  ? "Write a comment, or select words in the document to comment on them…"
  // A video has no spot worth pointing at, so its comments mark a moment: pause,
  // and the comment is pinned to that second.
  : kind === "video"
    ? "Write a comment, or pause the video to comment on that moment…"
    : `Write a comment, or click a spot on the ${WHAT[kind]} to comment on it…`;

/** The query string a team route reads the kind from ("" for the text document). */
export const kindQuery = (kind: ReviewKind) => (kind === "doc" ? "" : `?kind=${kind}`);
