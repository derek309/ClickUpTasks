// SERVER ONLY. What Claude can do to a task's reviews over MCP (Derek, 2026-09-13:
// "give claude code full control and access", "including drafting emails"): the
// client document, the image review and the HTML review, end to end. The hosted
// MCP (src/app/api/mcp/handler.ts) passes these into mcp/core.mjs, whose tools only
// describe the arguments. Every function returns the text Claude reads.
//
// Claude acts as its own member (CLICKUPTASKS_MEMBER_ID, u_claude) and as an admin,
// so it can make a review link live on a first send. Its rules are the app's own
// (reviewService.ts). Two of Derek's decisions sit here: the review email is only
// ever a draft a person sends, and Claude's comments never email the client. Every
// change also writes a short event on the task, which reloads it where it is open.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { APP_URL } from "./appUrl";
import { liveDocument, linkState, revokeDocLink, reviewTask, type LiveDocument, type ReviewActor, type TeamTask } from "./taskDocumentServer";
import {
  createReview, deleteReview, pickReviewVersion, removeReviewVersion, renameReview, reopenReview, restoreReview, sendReview, setReviewStage, writeDocBody,
} from "./reviewService";
import {
  deleteDocComment, discardVersionFile, docComments, docVersionFile, editDocComment, finishDocUpload, postDocComment, readPageFile,
  sharedVersionFiles, startDocUpload, storeImageFile, storePageFile, type DocActor,
} from "./taskDocumentFiles";
import { fetchImage } from "./safeFetch";
import { MAX_SHARED_FILE_BYTES } from "./uploadTypes";
import { PAGE_TOO_BIG, pageText, pageTooBig } from "./pageHtml";
import { buildReviewEmail } from "./reviewEmail";
import { placeDraftLink } from "./draftLink";
import { summarizeDocChanges, summarizeTextChanges } from "./docDiff";
import { htmlToText } from "./data";
import { TASK_FILES_BUCKET } from "./db";
import { kindInSentence, kindTitle, kindWhat, type FileKind, type ReviewKind } from "./reviewKinds";
import { MAX_SET_IMAGES, cleanImageLabel, imageLabel, parseImageSet, type ImageSetItem } from "./imageSet";
import { docHtmlToText } from "../../mcp/core.mjs";

export type ReviewVersion = number | "next";
/** One image for an image review version: from a link or an upload, where it goes
 *  (1 based) and what it is called. */
export type VersionImage = { imageUrl?: string; uploadId?: string; name?: string; label?: string; position?: number };
export type ReviewStage = "draft" | "with_client" | "client_submitted" | "approved" | "completed";
const KINDS: ReviewKind[] = ["doc", "image", "page"];

/** Save the task's draft email without replacing one already there (unless asked).
 *  updated_by null is what makes a task open in the app pick it up live. True when
 *  it was saved. */
export async function saveDraftEmail(taskId: string, draft: Record<string, unknown>, replace: boolean): Promise<boolean> {
  let query = supabaseAdmin.from("tasks").update({ draft_email: draft, updated_by: null }).eq("id", taskId);
  if (!replace) query = query.is("draft_email", null);
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  return !!data?.length;
}

export function createReviewServices({ memberId, origin = APP_URL }: { memberId: string; origin?: string }) {
  let name: Promise<string> | null = null;
  const actor: ReviewActor = {
    id: memberId, memberId, admin: true,
    label: () => (name ??= (async () => {
      const { data } = await supabaseAdmin.from("profiles").select("name").eq("member_id", memberId).maybeSingle();
      return ((data?.name as string | null) ?? "").trim() || "Claude";
    })()),
  };
  const fileActor = async (): Promise<DocActor> => ({ id: memberId, label: await actor.label() });
  const what = kindInSentence;

  async function taskFor(taskId: string): Promise<TeamTask | string> {
    const found = await reviewTask(taskId);
    return found.ok ? found.task : found.status === 404 ? `No task ${taskId}.` : found.error;
  }
  async function reviewFor(taskId: string, kind: ReviewKind, columns = "*"): Promise<{ task: TeamTask; doc: LiveDocument } | string> {
    const task = await taskFor(taskId);
    if (typeof task === "string") return task;
    const doc = await liveDocument(task.id, kind, columns);
    return doc ? { task, doc } : `"${task.title}" has no ${what(kind)} yet. create_review makes one.`;
  }
  /** A line on the task's activity, which also reloads the task where it is open. */
  async function event(taskId: string, body: string): Promise<void> {
    const comment = { id: "cm_" + randomUUID().slice(0, 8), authorId: memberId, kind: "event", at: new Date().toISOString(), body };
    try { await supabaseAdmin.rpc("append_comment", { task_id: taskId, comment }); } catch { /* the change itself landed */ }
  }
  /** The body behind a version number from get_review (a file id, or an image set),
   *  or "next": the working copy not sent yet. */
  async function versionFile(doc: LiveDocument, version: ReviewVersion): Promise<string | null> {
    const shown = await sharedVersionFiles(doc.id);
    if (version !== "next") return shown.find((v) => v.number === version)?.body ?? null;
    const body = typeof doc.body === "string" ? doc.body : "";
    return body && !shown.some((v) => v.body === body) ? body : null;
  }
  /** Keep one image for an image review: fetched from a public link, or an upload
   *  from start_image_upload. */
  async function storeImage(documentId: string, input: { imageUrl?: string; uploadId?: string; name?: string }, who: DocActor): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
    if (input.imageUrl) {
      const image = await fetchImage(input.imageUrl, MAX_SHARED_FILE_BYTES);
      if (!image.ok) return { ok: false, error: image.error };
      const fromUrl = decodeURIComponent(new URL(input.imageUrl).pathname.split("/").pop() ?? "");
      const stored = await storeImageFile(documentId, image.bytes, input.name ?? fromUrl, image, who);
      return stored.ok ? { ok: true, fileId: stored.fileId } : { ok: false, error: stored.error };
    }
    if (input.uploadId) {
      const fileName = input.name ?? input.uploadId.split("/").pop()?.replace(/^[0-9a-f-]{36}-/, "") ?? "";
      const finished = await finishDocUpload(documentId, input.uploadId, fileName, who, "image");
      return finished.ok ? { ok: true, fileId: finished.fileId } : { ok: false, error: finished.error };
    }
    return { ok: false, error: "Pass image_url (a public https link to the image) or upload_id (from start_image_upload)." };
  }

  /** Several images as one image review version, like a postcard's front and back
   *  (Derek, 2026-09-14). Without keepOthers the list is the whole version, in order;
   *  with it, each image replaces the one at its position in the working copy (or is
   *  added at the end), and the rest carry over. */
  async function addImages(taskId: string, images: VersionImage[], keepOthers: boolean): Promise<string> {
    const task = await taskFor(taskId);
    if (typeof task === "string") return task;
    if (images.length > MAX_SET_IMAGES) return `A version holds up to ${MAX_SET_IMAGES} images.`;
    const made = await createReview(task, "image", actor);
    if (!made.ok) return made.error;
    const doc = made.document;
    if (doc.approved_at) return "This image review is approved. update_review with reopen first.";
    const documentId = doc.id as string;
    const who = await fileActor();
    const items: ImageSetItem[] = keepOthers ? parseImageSet(doc.body) : [];
    const stored: string[] = [];
    const undo = async () => { for (const id of stored) await discardVersionFile(documentId, id); };
    for (const img of images) {
      const one = await storeImage(documentId, img, who);
      if (!one.ok) { await undo(); return one.error; }
      stored.push(one.fileId);
      const at = keepOthers && img.position ? img.position - 1 : -1;
      if (at >= 0 && at < items.length) items[at] = { file: one.fileId, label: img.label === undefined ? items[at].label : cleanImageLabel(img.label) };
      else items.push({ file: one.fileId, label: cleanImageLabel(img.label) });
    }
    if (items.length > MAX_SET_IMAGES) { await undo(); return `A version holds up to ${MAX_SET_IMAGES} images; this would make ${items.length}.`; }
    const picked = await pickReviewVersion(task.id, "image", actor, { images: items });
    if (!picked.ok) { await undo(); return picked.error; }
    await event(task.id, `${await actor.label()} added a new version of the image review`);
    const names = items.map((_, i) => `"${imageLabel(items, i)}"`).join(", ");
    return `Added a new version of the image review on "${task.title}" with ${items.length} ${items.length === 1 ? "image" : `images: ${names}`}. It's the working copy (version "next"), not sent yet: send_for_review sends it.`;
  }

  /** "Back" for a set's second of two images, "" for a version of one. */
  const placeOf = (items: ImageSetItem[], fileId: string) => {
    const i = items.findIndex((item) => item.file === fileId);
    return i >= 0 && items.length > 1 ? imageLabel(items, i) : "";
  };

  return {
    async listReviews(taskId: string): Promise<string> {
      const task = await taskFor(taskId);
      if (typeof task === "string") return task;
      const lines = [`Reviews on [${task.id}] ${task.title}:`];
      for (const kind of KINDS) {
        const doc = await liveDocument(task.id, kind, "id, title, status, version, draft_dirty");
        if (!doc) { lines.push(`- ${kindTitle(kind)} (kind "${kind}"): none`); continue; }
        const link = await linkState(doc.id, origin);
        const { count } = await supabaseAdmin.from("task_document_comments").select("id", { count: "exact", head: true }).eq("document_id", doc.id).is("completed_at", null);
        lines.push(`- ${kindTitle(kind)} (kind "${kind}") "${(doc.title as string) || task.title}": ${doc.status}, version ${doc.version}${doc.draft_dirty ? ", has unsent changes" : ""}, link ${link.live ? "on" : "off"}, ${count ?? 0} open comment(s)`);
      }
      const { data } = await supabaseAdmin.from("tasks").select("draft_email").eq("id", task.id).maybeSingle();
      const draft = data?.draft_email as { subject?: string } | null;
      lines.push(draft ? `Draft email: "${draft.subject ?? ""}", waiting for a person to send it.` : "Draft email: none.");
      return lines.join("\n");
    },

    async getReview(taskId: string, kind: ReviewKind, includeCode: boolean): Promise<string> {
      const found = await reviewFor(taskId, kind);
      if (typeof found === "string") return found;
      const { task, doc } = found;
      const link = await linkState(doc.id, origin);
      const out = [
        `${kindTitle(kind)} "${(doc.title as string) || task.title}" on [${task.id}] ${task.title}`,
        `stage: ${doc.status} · version ${doc.version}${doc.version ? "" : " (never sent)"} · link ${link.live ? (link.url ? `on: ${link.url}` : "on (it can't be shown again)") : "off"}`
          + `${doc.draft_dirty ? " · has unsent changes" : ""}${doc.approved_at ? " · approved: update_review with reopen before changing it" : ""}`,
      ];
      const numbers = new Map<string, number>();
      if (kind === "doc") {
        out.push(`\nWorking copy (the client sees the last version sent):\n${docHtmlToText(doc.body as string) || "(empty)"}`);
        const { data: versions } = await supabaseAdmin.from("task_document_versions")
          .select("version, kind, author_label, created_at").eq("document_id", doc.id).order("version", { ascending: false }).limit(10);
        if (versions?.length) out.push(`\nVersions (newest first):\n${versions.map((v) => `  - version ${v.version}: ${v.kind}${v.author_label ? ` by ${v.author_label}` : ""} (${v.created_at})`).join("\n")}`);
      } else {
        const shown = await sharedVersionFiles(doc.id);
        const working = doc.body as string;
        for (const v of shown) for (const img of v.images) numbers.set(img.fileId, v.number);
        const listImages = (images: { name: string; label: string }[]) => (images.length > 1 ? images.map((img, i) => `${i + 1}. ${img.label} (${img.name})`).join(", ") : images[0]?.name ?? "");
        out.push(`\nVersions the client can see (the last one is under review):\n${shown.length
          ? shown.map((v) => `  - version ${v.number}: ${listImages(v.images)}${v.fromClient ? " (made by the client)" : ""}${v.body === working ? " · working copy" : ""}`).join("\n")
          : "  (none sent yet)"}`);
        const items = parseImageSet(working);
        const files = (await Promise.all(items.map((item) => docVersionFile(doc.id, item.file, kind, false)))).filter((f) => !!f);
        const file = files[0] ?? null;
        if (files.length && !shown.some((v) => v.body === working)) {
          out.push(`  - version "next": ${listImages(files.map((f, i) => ({ name: f.name, label: imageLabel(items, i) })))} · working copy, not sent yet`);
        }
        if (kind === "image") {
          for (const [i, f] of files.entries()) {
            const { data } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).createSignedUrl(f.path, 3600);
            if (data?.signedUrl) out.push(`${i === 0 ? "\n" : ""}Working image ${files.length > 1 ? `${i + 1} "${imageLabel(items, i)}" ` : ""}(this link works for an hour): ${data.signedUrl}`);
          }
        }
        if (file && kind === "page") {
          const html = await readPageFile(doc.id, file.id, false);
          if (html != null) out.push(includeCode ? `\nWorking page code:\n${html}` : `\nWorking page text (include_code shows the HTML):\n${pageText(html).slice(0, 8000)}`);
        }
      }
      const comments = await docComments(doc.id);
      // Which image of its version a pin is on, when the version holds several.
      const setsNewestFirst = kind === "image" ? [(doc.body as string) ?? "", ...(await sharedVersionFiles(doc.id)).map((v) => v.body).reverse()] : [];
      const pinPlace = (fileId: string) => {
        const holder = setsNewestFirst.map(parseImageSet).find((items) => items.some((item) => item.file === fileId));
        return holder ? placeOf(holder, fileId) : "";
      };
      if (comments.length) {
        out.push(`\nComments (the client sees these too):\n${comments.map((c) => `  - [${c.id}] ${c.authorLabel}${c.fromClient ? " (client)" : ""}, ${c.createdAt}`
          + `${c.completedAt ? " · done" : ""}${c.pin ? ` · pin ${c.pin.number} on version ${numbers.get(c.pin.fileId) ?? "next"}${pinPlace(c.pin.fileId) ? ` (${pinPlace(c.pin.fileId)})` : ""} at x ${c.pin.x}, y ${c.pin.y}` : ""}`
          + `${c.quote ? ` · on "${c.quote.replace(/\n/g, " … ")}"` : ""}${c.attachmentFileId ? " · has a file" : ""}: ${c.body}`).join("\n")}`);
      }
      return out.join("\n");
    },

    async createReview(taskId: string, kind: ReviewKind, title?: string): Promise<string> {
      const task = await taskFor(taskId);
      if (typeof task === "string") return task;
      const made = await createReview(task, kind, actor);
      if (!made.ok) return made.error;
      if (title !== undefined) {
        const named = await renameReview(task.id, kind, actor, title);
        if (!named.ok) return named.error;
      }
      if (!made.created) return `"${task.title}" already has a ${what(kind)}, so nothing new was made. get_review shows it.`;
      await event(task.id, `${await actor.label()} started the ${what(kind)}`);
      const next = { doc: "write_document writes it", image: "add_review_version adds the image (image_url, or upload_id from start_image_upload)", page: "add_review_version adds the page's HTML" }[kind];
      return `Created the ${what(kind)} on "${task.title}". ${next}, then send_for_review sends it.`;
    },

    async updateReview(taskId: string, kind: ReviewKind, change: { title?: string; stage?: ReviewStage; reopen?: boolean; imageLabels?: string[] }): Promise<string> {
      const found = await reviewFor(taskId, kind, "id, body");
      if (typeof found === "string") return found;
      const done: string[] = [];
      if (change.reopen) {
        const r = await reopenReview(found.task.id, kind, actor);
        if (!r.ok) return r.error;
        done.push("reopened it");
      }
      if (change.stage) {
        const r = await setReviewStage(found.task.id, kind, actor, change.stage);
        if (!r.ok) return r.error;
        done.push(`set the stage to ${change.stage}`);
      }
      if (change.title !== undefined) {
        const r = await renameReview(found.task.id, kind, actor, change.title);
        if (!r.ok) return r.error;
        done.push(change.title.trim() ? `renamed it "${change.title.trim()}"` : "cleared its name");
      }
      if (change.imageLabels) {
        if (kind !== "image") return "image_labels is for an image review.";
        const items = parseImageSet(found.doc.body);
        if (!items.length) return "The image review has no images yet. add_review_version adds them.";
        const relabelled = items.map((item, i) => ({ file: item.file, label: cleanImageLabel(change.imageLabels![i] ?? item.label) }));
        const r = await pickReviewVersion(found.task.id, "image", actor, { images: relabelled });
        if (!r.ok) return r.error;
        done.push(`labelled its images ${relabelled.map((_, i) => `"${imageLabel(relabelled, i)}"`).join(", ")} (send_for_review shows the client)`);
      }
      if (!done.length) return "Nothing to change: pass title, stage, reopen or image_labels.";
      await event(found.task.id, `${await actor.label()} ${done.join(" and ")} on the ${what(kind)}`);
      return `On the ${what(kind)}: ${done.join(", ")}.`;
    },

    async writeDocument(taskId: string, html: string, title?: string): Promise<string> {
      const task = await taskFor(taskId);
      if (typeof task === "string") return task;
      const made = await createReview(task, "doc", actor);
      if (!made.ok) return made.error;
      if (title !== undefined) {
        const named = await renameReview(task.id, "doc", actor, title);
        if (!named.ok) return named.error;
      }
      const r = await writeDocBody(task.id, actor, { body: html, checkpoint: true });
      if (!r.ok) return r.error;
      await event(task.id, `${await actor.label()} ${made.created ? "wrote" : "updated"} the client document draft`);
      const version = Number(r.document.version ?? 0);
      return `${made.created ? "Created" : "Updated"} the client document on "${task.title}". ${version ? `The client still sees version ${version} until it's sent.` : "It hasn't been sent to the client."} send_for_review sends it.`;
    },

    async startImageUpload(taskId: string, fileName: string, size: number): Promise<string> {
      const task = await taskFor(taskId);
      if (typeof task === "string") return task;
      const made = await createReview(task, "image", actor);
      if (!made.ok) return made.error;
      if (made.document.approved_at) return "This image review is approved. update_review with reopen first.";
      const r = await startDocUpload(made.document.id as string, fileName, size, "image");
      if (!r.ok) return r.error;
      return `Upload the file with one PUT to this link (it works once, for a short while):\n${r.uploadUrl}\n\n`
        + `For example: curl -X PUT -H "Content-Type: image/png" --data-binary @"/path/to/${fileName}" "<the link>"\n`
        + `Then call add_review_version with kind "image" and upload_id "${r.path}".`;
    },

    async addVersion(taskId: string, kind: FileKind, input: { imageUrl?: string; uploadId?: string; html?: string; name?: string; images?: VersionImage[]; keepOthers?: boolean }): Promise<string> {
      if (kind === "image" && input.images?.length) return addImages(taskId, input.images, !!input.keepOthers);
      const task = await taskFor(taskId);
      if (typeof task === "string") return task;
      const made = await createReview(task, kind, actor);
      if (!made.ok) return made.error;
      const doc = made.document;
      if (doc.approved_at) return `This ${what(kind)} is approved. update_review with reopen first.`;
      const documentId = doc.id as string;
      const who = await fileActor();
      let fileId: string;
      if (kind === "page") {
        if (!input.html?.trim()) return "Pass the page's whole HTML in html.";
        if (pageTooBig(input.html)) return PAGE_TOO_BIG;
        const stored = await storePageFile(documentId, input.html, input.name ?? "", who);
        if (!stored.ok) return stored.error;
        fileId = stored.fileId;
      } else {
        const one = await storeImage(documentId, input, who);
        if (!one.ok) return one.error;
        fileId = one.fileId;
      }
      const picked = await pickReviewVersion(task.id, kind, actor, { file: fileId });
      if (!picked.ok) {
        await discardVersionFile(documentId, fileId);
        return picked.error;
      }
      await event(task.id, `${await actor.label()} added a new version of the ${what(kind)}`);
      return `Added a new version of the ${what(kind)} on "${task.title}". It's the working copy (version "next"), not sent yet: send_for_review sends it.`;
    },

    async useVersion(taskId: string, kind: ReviewKind, version: ReviewVersion): Promise<string> {
      const found = await reviewFor(taskId, kind, "id, body");
      if (typeof found === "string") return found;
      let r;
      if (kind === "doc") {
        if (version === "next") return "The client document's working copy is its text; pass a version number to bring an earlier one back.";
        r = await writeDocBody(found.task.id, actor, { restoreVersion: version });
      } else {
        const fileId = await versionFile(found.doc, version);
        if (!fileId) return `There is no version ${version} on the ${what(kind)}. get_review lists them.`;
        r = await pickReviewVersion(found.task.id, kind, actor, { file: fileId });
      }
      if (!r.ok) return r.error;
      await event(found.task.id, `${await actor.label()} brought back version ${version} of the ${what(kind)}`);
      return `Version ${version} is the working copy of the ${what(kind)} again. send_for_review sends it.`;
    },

    async removeVersion(taskId: string, kind: FileKind, version: ReviewVersion): Promise<string> {
      // A set's images carried into other versions stay; the rest go with their pins.
      const found = await reviewFor(taskId, kind, "id, body");
      if (typeof found === "string") return found;
      const fileId = await versionFile(found.doc, version);
      if (!fileId) return `There is no version ${version} on the ${what(kind)}. get_review lists them.`;
      const r = await removeReviewVersion(found.task.id, kind, actor, fileId);
      if (!r.ok) return r.error;
      await event(found.task.id, `${await actor.label()} removed version ${version} of the ${what(kind)}`);
      return `Removed version ${version} of the ${what(kind)}.${r.document.body ? "" : ` There is nothing left on the ${what(kind)} to review.`}`;
    },

    async sendForReview(taskId: string, kind: ReviewKind, email: { draftEmail: boolean; subject?: string; bodyHtml?: string }): Promise<string> {
      const found = await reviewFor(taskId, kind, "id, title, version");
      if (typeof found === "string") return found;
      const { task, doc } = found;
      const sent = await sendReview(task, kind, actor, Number(doc.version ?? 0), origin);
      if (!sent.ok) return sent.error;
      const label = await actor.label();
      // An image or HTML review's versions are numbered by file, as get_review lists them.
      const number = kind === "doc" ? sent.version : (await sharedVersionFiles(doc.id)).at(-1)?.number ?? sent.version;
      // The same step the drawer takes after a send: the task waits on the client.
      await event(task.id, `${label} sent version ${number} of the ${what(kind)} for review`);
      if (task.status !== "waiting") await supabaseAdmin.from("tasks").update({ status: "waiting", waiting_on_client: true, updated_by: null }).eq("id", task.id);

      let emailNote = "No email was drafted.";
      if (email.draftEmail) {
        let text = "";
        let changes: string | null = null;
        if (kind === "doc") {
          const { data: versions } = await supabaseAdmin.from("task_document_versions")
            .select("version, body").eq("document_id", doc.id).lte("version", sent.version).order("version", { ascending: false }).limit(2);
          const [latest, before] = (versions ?? []) as { body: string }[];
          text = latest ? htmlToText(latest.body).slice(0, 3000) : "";
          changes = latest && before ? summarizeDocChanges(before.body, latest.body) : null;
        } else {
          const [before, latest] = (await sharedVersionFiles(doc.id)).slice(-2);
          if (before && latest) {
            // An HTML review says which words changed, like a document; an image can't.
            const texts = kind === "page"
              ? await Promise.all([readPageFile(doc.id, before.fileId, true), readPageFile(doc.id, latest.fileId, true)])
              : null;
            changes = (texts?.[0] != null && texts[1] != null ? summarizeTextChanges(pageText(texts[0]), pageText(texts[1])) : null)
              ?? `A new version of the ${kindWhat(kind)}.`;
          }
        }
        const built = buildReviewEmail({ kind, url: sent.url, name: ((doc.title as string) ?? "").trim() || task.title, text, changes });
        const now = new Date().toISOString();
        const draft = {
          ...built,
          ...(email.subject?.trim() ? { subject: email.subject.trim() } : {}),
          ...(email.bodyHtml ? { body: placeDraftLink(email.bodyHtml, built.link) } : {}),
          createdAt: now, updatedAt: now,
        };
        emailNote = await saveDraftEmail(task.id, draft, false)
          ? `Drafted the review email "${draft.subject}" on the task. A person reads it and clicks Send; nothing was emailed.`
          : "The task already has a draft email, so it was left alone (draft_email with replace swaps it).";
      }
      return [
        `Sent version ${number} of the ${what(kind)} on "${task.title}" for review.`,
        `Review link: ${sent.url ?? "on, but it can't be shown again (a teammate can make a new link in the app)"}`,
        task.status === "waiting" ? "The task was already Waiting." : "The task is now Waiting.",
        emailNote,
      ].join("\n");
    },

    async getReviewLink(taskId: string, kind: ReviewKind): Promise<string> {
      const found = await reviewFor(taskId, kind, "id");
      if (typeof found === "string") return found;
      const link = await linkState(found.doc.id, origin);
      if (!link.live) return `The ${what(kind)}'s link is off. send_for_review turns it on.`;
      return link.url
        ? `${link.url}\n\nThe client opens the ${what(kind)} here without signing in. Send it only to that client.`
        : `The link is on, but it can't be shown again. A teammate can make a new link in the app.`;
    },

    async revokeReviewLink(taskId: string, kind: ReviewKind): Promise<string> {
      const found = await reviewFor(taskId, kind, "id");
      if (typeof found === "string") return found;
      await revokeDocLink(found.doc.id);
      await event(found.task.id, `${await actor.label()} turned off the ${what(kind)}'s link`);
      return `The ${what(kind)}'s link is off for good. The next send_for_review makes a new one.`;
    },

    async addComment(taskId: string, kind: ReviewKind, text: string, extras: { quote?: string; pin?: { version: ReviewVersion; x: number; y: number; image?: string | number } }): Promise<string> {
      const found = await reviewFor(taskId, kind, "id, body");
      if (typeof found === "string") return found;
      let pin: { fileId: string; x: number; y: number } | undefined;
      if (extras.pin) {
        if (kind === "doc") return "Pins are for image and HTML reviews. On the client document, pass quote with the words the comment is about.";
        const body = await versionFile(found.doc, extras.pin.version);
        if (!body) return `There is no version ${extras.pin.version} on the ${what(kind)}. get_review lists them.`;
        // Which image: a 1 based position or a label, else the first.
        const items = parseImageSet(body);
        const wanted = extras.pin.image;
        const index = wanted === undefined ? 0 : typeof wanted === "number"
          ? wanted - 1
          : items.findIndex((_, i) => imageLabel(items, i).toLowerCase() === String(wanted).trim().toLowerCase());
        if (index < 0 || index >= items.length) return `Version ${extras.pin.version} has no image ${JSON.stringify(wanted)}. Its images: ${items.map((_, i) => `${i + 1} "${imageLabel(items, i)}"`).join(", ")}.`;
        pin = { fileId: items[index].file, x: extras.pin.x, y: extras.pin.y };
      }
      const r = await postDocComment(found.doc.id, text, await fileActor(), { quote: kind === "doc" ? extras.quote : undefined, pin });
      if (!r.ok) return r.error;
      await event(found.task.id, `${await actor.label()} commented on the ${what(kind)}`);
      return `Posted comment [${r.comment.id}]${r.comment.pin ? ` as pin ${r.comment.pin.number}` : ""} on the ${what(kind)}. The client sees it on the review page; no email was sent.`;
    },

    async updateComment(commentId: string, change: { text?: string; done?: boolean }): Promise<string> {
      const scope = await commentScope(commentId);
      if (typeof scope === "string") return scope;
      const r = await editDocComment(scope.documentId, commentId, { body: change.text, done: change.done }, await fileActor());
      if (!r.ok) return r.status === 403 ? "Claude can only change the words of comments it wrote. It can still mark any comment done." : r.error;
      return `Updated comment [${commentId}]${change.done === undefined ? "" : change.done ? ", marked done" : ", open again"}.`;
    },

    async deleteComment(commentId: string): Promise<string> {
      const scope = await commentScope(commentId);
      if (typeof scope === "string") return scope;
      const r = await deleteDocComment(scope.documentId, commentId, await fileActor(), true);
      return r.ok ? `Deleted comment [${commentId}].` : r.error;
    },

    async deleteReview(taskId: string, kind: ReviewKind): Promise<string> {
      const task = await taskFor(taskId);
      if (typeof task === "string") return task;
      const r = await deleteReview(task.id, kind, actor);
      if (!r.ok) return r.error;
      if (!r.deleted) return `"${task.title}" has no ${what(kind)} to delete.`;
      await event(task.id, `${await actor.label()} deleted the ${what(kind)}`);
      return `Deleted the ${what(kind)} on "${task.title}". Its link stops working; restore_review brings it back within 30 days.`;
    },

    async restoreReview(taskId: string, kind: ReviewKind): Promise<string> {
      const task = await taskFor(taskId);
      if (typeof task === "string") return task;
      const r = await restoreReview(task.id, kind, actor, null);
      if (!r.ok) return r.error;
      await event(task.id, `${await actor.label()} restored the ${what(kind)}`);
      return `Restored the ${what(kind)} on "${task.title}", with its versions, comments and link.`;
    },
  };

  async function commentScope(commentId: string): Promise<{ documentId: string } | string> {
    const gone = `No comment ${commentId}.`;
    if (!/^tdm_[0-9a-f-]{36}$/.test(commentId)) return gone;
    const { data: comment } = await supabaseAdmin.from("task_document_comments").select("document_id").eq("id", commentId).maybeSingle();
    if (!comment) return gone;
    const { data: doc } = await supabaseAdmin.from("task_documents").select("task_id, deleted_at").eq("id", comment.document_id).maybeSingle();
    if (!doc || doc.deleted_at) return gone;
    const task = await taskFor(doc.task_id as string);
    return typeof task === "string" ? task : { documentId: comment.document_id as string };
  }
}

export type ReviewServices = ReturnType<typeof createReviewServices>;
