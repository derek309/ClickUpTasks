// Shared by the server and both review pages: the kinds of client review
// document a task can have, and what each is called. One place, so a new kind is
// one line here rather than a string choice in every file.
//   doc    the text document the team writes (supabase/task-documents.sql)
//   image  an image the client pins comments to (supabase/task-image-reviews.sql)
//   page   a web page, uploaded .html or pasted code, the client pins comments to
//          and can reword (supabase/task-page-reviews.sql)
// image and page are "file kinds": their body and every version body hold the id
// of a file, not HTML.

export type ReviewKind = "doc" | "image" | "page";
export type FileKind = Exclude<ReviewKind, "doc">;

/** Any value (a query string, a row) as a kind; anything unknown is the text document. */
export const parseKind = (raw: unknown): ReviewKind => (raw === "image" || raw === "page" ? raw : "doc");

/** Whether the kind's body is a file id rather than HTML. */
export const isFileKind = (kind: ReviewKind): kind is FileKind => kind !== "doc";

/** The purpose its version files are stored under in task_document_files. */
export const filePurpose = (kind: FileKind): FileKind => kind;

const WHAT: Record<ReviewKind, string> = { doc: "document", image: "image", page: "page" };
const NOUN: Record<ReviewKind, string> = { doc: "client document", image: "image", page: "web page" };
const TITLE: Record<ReviewKind, string> = { doc: "Client document", image: "Image review", page: "Web page review" };
const NEW_NAME: Record<ReviewKind, string> = { doc: "New document", image: "New image review", page: "New web page review" };

/** The short word: "This image is approved." */
export const kindWhat = (kind: ReviewKind) => WHAT[kind];
/** What activity lines and notifications call it: "approved the web page". */
export const kindNoun = (kind: ReviewKind) => NOUN[kind];
/** Its name on the task: "Web page review". */
export const kindTitle = (kind: ReviewKind) => TITLE[kind];
/** Its row's name on the team's task until someone names it, so a task's document,
 *  image and page reviews don't all read as the task's own title (Derek,
 *  2026-09-13). The client still sees the task's title. */
export const kindNewName = (kind: ReviewKind) => NEW_NAME[kind];
export const noDocumentYet = (kind: ReviewKind) => `This task has no ${kind === "doc" ? "client document" : TITLE[kind].toLowerCase()} yet.`;

/** The query string a team route reads the kind from ("" for the text document). */
export const kindQuery = (kind: ReviewKind) => (kind === "doc" ? "" : `?kind=${kind}`);
