"use client";

// The client document on a task: the team writes it, sends the client a private
// link (no login), and sees what the client changed or approved. See
// supabase/task-documents.sql and src/lib/taskDocumentServer.ts.
//
// kind "image" is the task's image review (Derek, 2026-09-12, supabase/
// task-image-reviews.sql): the team uploads an image, the client clicks spots on it
// to leave numbered comments or files, then asks for changes or approves. A revised
// image is a new version, and the old ones keep their pins a click away. Everything
// else here is shared with the document: the link, stages, files, comments,
// history, the review email and delete.
//
// In the task it is one line; Open shows it over the whole screen (TaskWorkItem). Reads go through the browser
// client and row level security (db.ts); every write goes through
// /api/tasks/[id]/document so the HTML is cleaned on the server and an approved
// document stays locked. A client's send, approval or file lands on the task row
// live (status and an event comment), and that is what makes this refetch.
import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS_META, htmlToText, timeAgo, type Task, type TaskStatus } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";
import {
  fetchTaskDocument, fetchTaskDocumentVersions, fetchTaskDocumentFiles, fetchTaskDocumentCheckpoints, fetchTaskDocumentComments,
  fetchDeletedTaskDocuments, type DeletedTaskDocument,
  rowToTaskDocument, signedUrlForFile,
  type TaskDocument as Doc, type TaskDocumentKind, type TaskDocumentStatus, type TaskDocumentVersion,
  type TaskDocumentFile, type TaskDocumentCheckpoint, type TaskDocumentComment,
} from "@/lib/db";
import { diffDocText, summarizeDocChanges } from "@/lib/docDiff";
import { addDocFiles, uploadSharedFile } from "@/lib/docFileUpload";
import { sentImages } from "@/lib/imagePins";
import { formatFileSize, isPreviewableImage } from "@/lib/uploadTypes";
import { RichTextEditor } from "./RichTextEditor";
import { useDebouncedCommit } from "./useDebouncedCommit";
import {
  CommentThread, FileDropLine, ImageLightbox, ImagePinBoard, ImageThumbGrid, ImageVersionPicker, WorkItemBadge, WorkItemRow, WorkItemWindow,
  commentsFor, nextPin, quietButton as quiet, type PreviewImage,
} from "./TaskWorkItem";

// The document's stages, in order (Derek, 2026-09-11: "draft, client review,
// changes, approved, completed"). Sends and client actions move it on their own;
// the team can also pick one. Completed locks it like a client approval does.
const STATUS_VIEW: Record<TaskDocumentStatus, { label: string; tone: TaskStatus }> = {
  draft: { label: "Draft", tone: "todo" },
  with_client: { label: "Client review", tone: "waiting" },
  client_submitted: { label: "Changes", tone: "changes_requested" },
  approved: { label: "Approved", tone: "approved" },
  completed: { label: "Completed", tone: "done" },
};
const STAGES = Object.keys(STATUS_VIEW) as TaskDocumentStatus[];
const KIND_LABEL: Record<TaskDocumentKind, Record<TaskDocumentVersion["kind"], string>> = {
  doc: { sent: "Sent to client", client_submitted: "Client sent changes", client_approved: "Client approved" },
  image: { sent: "Sent to client", client_submitted: "Client asked for changes", client_approved: "Client approved" },
};
const HISTORY_PREVIEW = 5;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

const docApi = (taskId: string, kind: TaskDocumentKind, path: string, init?: RequestInit) =>
  authedFetch(`/api/tasks/${encodeURIComponent(taskId)}/document${path}${kind === "image" ? "?kind=image" : ""}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

export function TaskDocument({ task, kind = "doc", onPatch, pushToast, startNonce, onPresence, meId, onEmailClient }: {
  task: Task;
  /** "image" for the task's image review. */
  kind?: TaskDocumentKind;
  onPatch: (patch: Partial<Task>) => void;
  pushToast: (text: string) => void;
  canAdmin: boolean;
  /** The viewer's member id, the id a teammate's comment is saved under, so their own comments can be edited. */
  meId?: string | null;
  /** Opens an email to the client with the review link, written with AI: after a
   *  send, or from the Email client button. `changes` sums up what changed since
   *  the version before. Returns true when it opened one (there is a contact to
   *  email), so this window steps aside. */
  onEmailClient?: (review: { kind: TaskDocumentKind; url: string | null; name: string; text: string; changes: string | null }) => boolean;
  /** Bumped by the "+ Client document" or "+ Image review" chip: start it if there is none, then show it. */
  startNonce: number;
  /** Tells the drawer whether a document exists, so it can hide the chip. */
  onPresence: (exists: boolean) => void;
}) {
  const image = kind === "image";
  const what = image ? "image review" : "document";
  const api = (path: string, init?: RequestInit) => docApi(task.id, kind, path, init);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [link, setLink] = useState<{ live: boolean; copyable: boolean } | null>(null);
  const [files, setFiles] = useState<TaskDocumentFile[]>([]);
  const [versions, setVersions] = useState<TaskDocumentVersion[]>([]);
  const [checkpoints, setCheckpoints] = useState<TaskDocumentCheckpoint[]>([]);
  // The thread shared with the client (Derek, 2026-09-11: "a chat box for comments").
  const [comments, setComments] = useState<TaskDocumentComment[]>([]);
  // Words picked in the document for the next comment, and the comment whose words
  // are shown (Derek, 2026-09-12: comments on a specific sentence).
  const [quoteDraft, setQuoteDraft] = useState<string | null>(null);
  const [focusedComment, setFocusedComment] = useState<string | null>(null);
  // Image review: the pin dropped for the next comment, and the version looked at
  // (null follows the newest).
  const [pinDraft, setPinDraft] = useState<{ fileId: string; x: number; y: number; number: number } | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  // Documents deleted from this task that can still be restored (30 days).
  const [deletedDocs, setDeletedDocs] = useState<DeletedTaskDocument[]>([]);
  const [full, setFull] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [allHistory, setAllHistory] = useState(false);
  // History sits under the Send buttons, closed until asked for (Derek, 2026-09-11).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Moving between in place and full screen remounts the editor; it starts from
  // what was last typed, which may not be saved back from the server yet.
  const [seed, setSeed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Signed links for image thumbnails, by storage path, and the open preview.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<number | null>(null);
  // The client sent changes while this teammate still had unsent edits.
  const [clientCrossed, setClientCrossed] = useState<TaskDocumentVersion | null>(null);
  // Typing saves on its own; this is what says so (Derek, 2026-09-11: "add a save draft").
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved">("idle");
  const commit = useDebouncedCommit();
  const titleCommit = useDebouncedCommit(800);
  const saving = useRef<Promise<boolean> | null>(null);
  // A save that failed tries again on its own (Derek: "make sure the edits auto save for sure").
  const retry = useRef<number | null>(null);
  const versionRef = useRef<number | null>(null);
  // What the editor holds right now, for Save draft and for switching views.
  const latestHtml = useRef<string | null>(null);

  const load = useCallback(async () => {
    const fresh = await fetchTaskDocument(task.id, kind);
    const previous = versionRef.current;
    versionRef.current = fresh?.version ?? null;
    setDoc(fresh);
    setLoaded(true);
    void fetchDeletedTaskDocuments(task.id, kind).then(setDeletedDocs);
    if (!fresh) return;
    void fetchTaskDocumentFiles(fresh.id).then(setFiles);
    // A client's comment logs an event on the task too, so it arrives here the same way.
    void fetchTaskDocumentComments(fresh.id).then(setComments);
    if (kind === "doc" && previous !== null && fresh.version > previous) {
      const latest = (await fetchTaskDocumentVersions(fresh.id))[0];
      if (latest && latest.kind !== "sent") {
        // The client published. Show their text, unless the team is mid edit:
        // then keep the team's working copy and offer theirs.
        if (fresh.draftDirty) setClientCrossed(latest);
        else { latestHtml.current = null; setSeed(null); setNonce((n) => n + 1); }
      }
    }
    const res = await docApi(task.id, kind, "/link");
    if (res.ok) setLink(await res.json());
  }, [task.id, kind]);

  // Fetch when the task opens. State is set only after the request resolves; the
  // rule flags any fetch on mount, and this app marks each one the same way.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  // A client's send, approval or file lands on the task row live (status and an
  // event comment), so either changing is the cue to look again.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (loaded) void load(); }, [task.status, task.comments.length]);

  const exists = !!doc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onPresence(exists); }, [exists]);

  // Typing is never left waiting: the pending save lands when the tab is hidden,
  // the page closes, or the task closes (the commit hook flushes on unmount).
  useEffect(() => {
    const flushAll = () => { commit.flush(); titleCommit.flush(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flushAll(); };
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      document.removeEventListener("visibilitychange", onVisibility);
      if (retry.current) window.clearTimeout(retry.current);
    };
  }, [commit.flush, titleCommit.flush]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = full;
  useEffect(() => {
    if (!visible || !doc) return;
    let cancelled = false;
    void Promise.all([fetchTaskDocumentVersions(doc.id), fetchTaskDocumentCheckpoints(doc.id)]).then(([v, c]) => {
      if (!cancelled) { setVersions(v); setCheckpoints(c); }
    });
    return () => { cancelled = true; };
  }, [visible, doc?.id, doc?.version, doc?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Thumbnails (and an image review's images) load only while it is open, an hour's link each.
  const imagePaths = files.filter((f) => !f.removedAt && isPreviewableImage(f.name)).map((f) => f.path).join("|");
  useEffect(() => {
    const missing = imagePaths ? imagePaths.split("|").filter((p) => !thumbs[p]) : [];
    if (!visible || !missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async (p) => [p, await signedUrlForFile(p, 3600)] as const)).then((pairs) => {
      if (!cancelled) setThumbs((t) => ({ ...t, ...Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => !!pair[1])) }));
    });
    return () => { cancelled = true; };
  }, [visible, imagePaths]); // eslint-disable-line react-hooks/exhaustive-deps

  const readJson = async (res: Response) => res.json().catch(() => ({} as Record<string, unknown>));
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); return true; } catch { return false; } };

  // Each switch lands the pending save and carries what was typed across.
  const switchView = (next: { full: boolean }, d: Doc | null = doc) => {
    commit.flush();
    titleCommit.flush();
    setSeed(latestHtml.current);
    if (d && !visible) setTitleDraft(d.title);
    setFull(next.full);
  };

  const create = async (): Promise<Doc | null> => {
    setBusy("create");
    const res = await api("", { method: "POST", body: "{}" });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? `Could not start the ${what}.`); return null; }
    const created = rowToTaskDocument(j.document);
    versionRef.current = created.version;
    setDoc(created);
    setLoaded(true);
    return created;
  };

  // The chip: show the document, making it first when there is none.
  const startSeen = useRef(startNonce);
  useEffect(() => {
    if (startNonce === startSeen.current) return;
    startSeen.current = startNonce;
    void (async () => {
      const d = doc ?? await create();
      if (d) switchView({ full: true }, d);
    })();
  }, [startNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (html: string): Promise<boolean> => {
    setSaveState("saving");
    if (retry.current) { window.clearTimeout(retry.current); retry.current = null; }
    const payload = JSON.stringify({ body: html });
    // A failed save waits five seconds and tries again, unless newer typing has
    // taken over (that typing brings its own save).
    const tryAgain = (message: string) => {
      if (!retry.current) pushToast(`${message} Trying again in a few seconds.`);
      retry.current = window.setTimeout(() => {
        retry.current = null;
        if ((latestHtml.current ?? html) === html) void save(html);
      }, 5000);
    };
    // keepalive lets a save started as the page closes still reach the server;
    // browsers only allow it for small bodies.
    const p = api("", { method: "PATCH", body: payload, keepalive: payload.length < 60_000 })
      .then(async (res) => {
        const j = await readJson(res);
        if (res.ok) { setDoc(rowToTaskDocument(j.document)); setSaveState("saved"); return true; }
        setSaveState("unsaved");
        // Approved or otherwise refused: trying again would be refused again.
        if (res.status === 409 || res.status === 400 || res.status === 413) pushToast((j.error as string) ?? "Could not save the document.");
        else tryAgain((j.error as string) ?? "Could not save the document.");
        return false;
      })
      .catch(() => { setSaveState("unsaved"); tryAgain("Could not reach the server to save."); return false; });
    saving.current = p;
    return p;
  };

  // Saves now and puts this draft in the history under your name.
  const saveDraft = async () => {
    commit.flush();
    if (await saving.current === false || !doc) return;
    setSaveState("saving");
    const res = await api("", { method: "PATCH", body: JSON.stringify({ body: latestHtml.current ?? doc.body, checkpoint: true }) });
    const j = await readJson(res);
    if (!res.ok) { setSaveState("unsaved"); pushToast((j.error as string) ?? "Could not save the document."); return; }
    setDoc(rowToTaskDocument(j.document));
    setSaveState("saved");
    pushToast("Draft saved.");
  };

  const saveTitle = async (value: string) => {
    if (!doc || value.trim() === doc.title.trim()) return;
    const res = await api("", { method: "PATCH", body: JSON.stringify({ title: value }), keepalive: true });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? `Could not rename the ${what}.`); return; }
    setDoc(rowToTaskDocument(j.document));
  };

  // An image review: upload an image and make it the one to send next. The first
  // image, or a new version of it (Derek, 2026-09-12: keep the old pins).
  const uploadImage = async (list: FileList) => {
    if (!doc || adding) return;
    const file = Array.from(list).find((f) => isPreviewableImage(f.name));
    if (!file) { pushToast("Upload a JPG, PNG, WebP or GIF image."); return; }
    setAdding(true);
    const up = await uploadSharedFile(file, (payload) => api("/files", { method: "POST", body: JSON.stringify({ ...payload, purpose: "image" }) }));
    if (!up.ok) { setAdding(false); pushToast(up.error); return; }
    const res = await api("", { method: "PATCH", body: JSON.stringify({ image: up.result.fileId }) });
    const j = await readJson(res);
    setAdding(false);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not use that image."); return; }
    setDoc(rowToTaskDocument(j.document));
    setViewingImage(null);
    setPinDraft(null);
    await load();
    pushToast(doc.version > 0 ? "New version uploaded. Send it when you're ready." : "Image added. Send it for review when you're ready.");
  };

  // Take a wrong image off (Derek, 2026-09-12: "a way to delete the image in case
  // it was the wrong one"). A sent one takes its pins with it, after a confirm.
  const removeImage = async (fileId: string, message: string) => {
    if (!doc || !window.confirm(message)) return;
    setBusy("remove");
    const res = await api("", { method: "PATCH", body: JSON.stringify({ removeImage: fileId }) });
    const j = await readJson(res);
    if (!res.ok) { setBusy(null); pushToast((j.error as string) ?? "Could not remove the image."); return; }
    // The versions list and pins change here and now, so a quick second click
    // never works from the list as it was before this removal.
    const at = new Date().toISOString();
    setFiles((fs) => fs.map((f) => (f.id === fileId ? { ...f, removedAt: at } : f)));
    setComments((cs) => cs.filter((c) => c.pin?.fileId !== fileId));
    setDoc(rowToTaskDocument(j.document));
    setViewingImage(null);
    setPinDraft(null);
    await load();
    setBusy(null);
    pushToast("Image removed.");
  };

  const send = async () => {
    if (!doc) return;
    commit.flush();
    await saving.current;
    setBusy("send");
    const res = await api("/send", { method: "POST", body: JSON.stringify({ baseVersion: doc.version }) });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not send."); if (res.status === 409) void load(); return; }
    const sentBody = doc.body;
    // The last version the client saw, to say what this send changed.
    const previousBody = doc.version > 0 ? versions[0]?.body : undefined;
    await load();
    if (task.status !== "waiting") onPatch({ status: "waiting" });
    const url = j.url as string | null;
    const copied = !!url && await copy(url);
    // Straight into an email to the client, written with AI (Derek, 2026-09-11:
    // "when we send for review can it pop up a box to draft an email to the
    // client"). The document window closes so the email is the one on screen.
    const emailing = onEmailClient?.({
      kind, url, name: doc.title.trim() || task.title,
      text: image ? "" : htmlToText(sentBody).slice(0, 3000),
      changes: image
        ? (sentImages(versions).length ? "A new version of the image." : null)
        : previousBody ? summarizeDocChanges(previousBody, sentBody) : null,
    }) ?? false;
    if (emailing) switchView({ full: false });
    if (copied) pushToast(emailing ? "Sent for review. Link copied and added to the email." : "Sent for review. Link copied, paste it to your client.");
    else if (url) pushToast(`Sent for review. Share this link: ${url}`);
    else pushToast("Sent for review.");
  };

  // The one link control (Derek, 2026-09-11: "just need a copy link button that's
  // all keep it simple"). Sending makes the link; deleting the document ends it.
  const fetchLink = async (): Promise<string | null> => {
    const res = await api("/link", { method: "POST", body: JSON.stringify({ action: "copy" }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not get the link."); return null; }
    return j.url as string;
  };
  const copyLink = async () => {
    setBusy("copy");
    const url = await fetchLink();
    setBusy(null);
    if (url) pushToast(await copy(url) ? "Link copied." : `Share this link: ${url}`);
  };

  // Email the client about the document at any time (Derek, 2026-09-11: "if we
  // make updates and changes we can click a button to draft an email to the
  // client"). Says what changed between the last two versions sent.
  const emailClient = async () => {
    if (!doc || !onEmailClient) return;
    commit.flush();
    await saving.current;
    setBusy("email");
    const url = link?.live && link.copyable ? await fetchLink() : null;
    setBusy(null);
    const [latest, before] = versions;
    const opened = onEmailClient({
      kind, url, name: doc.title.trim() || task.title,
      text: image ? "" : htmlToText(latest?.body ?? doc.body).slice(0, 3000),
      changes: image
        ? (sentImages(versions).length > 1 ? "A new version of the image." : null)
        : latest && before ? summarizeDocChanges(before.body, latest.body) : null,
    });
    if (opened) switchView({ full: false });
    else pushToast("Link a contact to this client to email them from here.");
  };

  const patchDoc = async (payload: Record<string, unknown>, done: string) => {
    commit.flush();
    await saving.current;
    const res = await api("", { method: "PATCH", body: JSON.stringify(payload) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? `Could not update the ${what}.`); return; }
    setDoc(rowToTaskDocument(j.document));
    latestHtml.current = null;
    setSeed(null);
    setNonce((n) => n + 1);
    setClientCrossed(null);
    pushToast(done);
  };

  const setStage = async (status: TaskDocumentStatus) => {
    if (!doc || status === doc.status) return;
    commit.flush();
    await saving.current;
    const res = await api("", { method: "PATCH", body: JSON.stringify({ status }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not change the stage."); return; }
    setDoc(rowToTaskDocument(j.document));
  };

  const deleteDocument = async () => {
    if (!doc || !window.confirm(`Delete this ${what}? You can restore it from this task for 30 days, with its versions, files and comments. The client's link stops working until then.`)) return;
    commit.flush();
    titleCommit.flush();
    await saving.current;
    setBusy("delete");
    const res = await api("", { method: "DELETE" });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? `Could not delete the ${what}.`); return; }
    setFull(false);
    versionRef.current = null;
    setDoc(null);
    setFiles([]);
    setComments([]);
    setLink(null);
    void fetchDeletedTaskDocuments(task.id, kind).then(setDeletedDocs);
    pushToast(`${image ? "Image review" : "Document"} deleted. Restore it from this task within 30 days.`);
  };

  const restoreDocument = async (documentId: string) => {
    setBusy("restore");
    const res = await api("/restore", { method: "POST", body: JSON.stringify({ documentId }) });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? `Could not restore the ${what}.`); return; }
    versionRef.current = null;
    await load();
    pushToast(`${image ? "Image review" : "Document"} restored.`);
  };

  const postComment = async (body: string, quote?: string | null, attachmentFileId?: string | null) => {
    const pin = image && pinDraft ? { fileId: pinDraft.fileId, x: pinDraft.x, y: pinDraft.y } : null;
    const res = await api("/comments", { method: "POST", body: JSON.stringify({ body, quote: quote ?? null, pin, attachmentFileId: attachmentFileId ?? null }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not post the comment."); return false; }
    setComments((c) => [...c, { ...(j.comment as TaskDocumentComment), authorId: meId ?? null }]);
    setQuoteDraft(null);
    setPinDraft(null);
    if (j.emailedClient) pushToast("Comment posted. We emailed the client a link to it.");
    return true;
  };

  // A file for the next comment: it goes on the document's files first.
  const attachFile = async (file: File) => {
    if (!doc) return null;
    const up = await uploadSharedFile(file, (payload) => api("/files", { method: "POST", body: JSON.stringify(payload) }));
    if (!up.ok) { pushToast(up.error); return null; }
    void fetchTaskDocumentFiles(doc.id).then(setFiles);
    return { id: up.result.fileId as string, name: file.name };
  };

  // Edit your own comment, tick any comment done, delete any comment.
  const changeComment = async (commentId: string, change: { body?: string; done?: boolean }) => {
    const res = await api("/comments", { method: "PATCH", body: JSON.stringify({ commentId, ...change }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not update the comment."); return false; }
    const next = j.comment as TaskDocumentComment;
    setComments((cs) => cs.map((c) => (c.id === commentId ? { ...next, authorId: c.authorId } : c)));
    return true;
  };
  const removeComment = async (commentId: string) => {
    if (!window.confirm("Delete this comment? The client stops seeing it too.")) return false;
    const res = await api("/comments", { method: "DELETE", body: JSON.stringify({ commentId }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not delete the comment."); return false; }
    setComments((cs) => cs.filter((c) => c.id !== commentId));
    return true;
  };

  const addFiles = async (list: FileList) => {
    if (!doc || adding) return;
    setAdding(true);
    const error = await addDocFiles(
      Array.from(list),
      (payload) => api("/files", { method: "POST", body: JSON.stringify(payload) }),
      () => { void fetchTaskDocumentFiles(doc.id).then(setFiles); },
    );
    setAdding(false);
    if (error) pushToast(error);
    await load();
  };

  const removeFile = async (f: TaskDocumentFile) => {
    if (!doc || !window.confirm(`Remove ${f.name}? The client stops seeing it too.`)) return;
    const res = await api("/files", { method: "DELETE", body: JSON.stringify({ fileId: f.id }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not remove the file."); return; }
    setFiles(await fetchTaskDocumentFiles(doc.id));
  };

  const openFile = async (f: TaskDocumentFile) => {
    const url = await signedUrlForFile(f.path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else pushToast("Could not open the file.");
  };

  const deletedLine = deletedDocs.length > 0 ? (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed px-4 py-2 text-[16px] text-muted">
      <span>{image ? "Deleted image review:" : "Deleted:"}</span>
      {deletedDocs.map((d) => (
        <span key={d.id} className="flex flex-wrap items-center gap-x-2">
          <span className="text-foreground">{d.title.trim() || task.title}</span>
          <span>{timeAgo(d.deletedAt)}</span>
          <button onClick={() => void restoreDocument(d.id)} disabled={busy !== null}
            className="font-semibold text-accent hover:underline disabled:opacity-50">{busy === "restore" ? "Restoring…" : "Restore"}</button>
        </span>
      ))}
    </div>
  ) : null;

  if (!doc) return deletedLine;

  const view = STATUS_VIEW[doc.status];
  const tone = STATUS_META[view.tone];
  const badge = <WorkItemBadge label={view.label} chip={tone.chip} dot={tone.dot} />;
  const completed = doc.status === "completed";
  const locked = !!doc.approvedAt || completed;
  const stageSelect = (
    <select value={doc.status} onChange={(e) => void setStage(e.target.value as TaskDocumentStatus)} aria-label={`${image ? "Image review" : "Document"} stage`}
      className="cursor-pointer rounded-full border-0 px-3 py-1 text-[16px] font-semibold outline-none" style={{ background: tone.chip, color: tone.dot }}>
      {STAGES.map((s) => <option key={s} value={s}>{STATUS_VIEW[s].label}</option>)}
    </select>
  );
  // An image review has nothing to send until there is an image.
  const needsSend = !locked && (!image || !!doc.body) && (doc.version === 0 || doc.draftDirty);
  const name = doc.title.trim() || task.title;
  const activeFiles = files.filter((f) => !f.removedAt && f.purpose === "file");
  const previewImages: PreviewImage[] = activeFiles
    .filter((f) => isPreviewableImage(f.name) && thumbs[f.path])
    .map((f) => ({ id: f.id, name: f.name, url: thumbs[f.path] }));
  const openFileOrPreview = (f: TaskDocumentFile) => {
    const i = previewImages.findIndex((p) => p.id === f.id);
    if (i >= 0) setLightbox(i);
    else void openFile(f);
  };
  const renderAttachment = (fileId: string) => {
    const f = activeFiles.find((x) => x.id === fileId);
    return f
      ? <button onClick={() => openFileOrPreview(f)} className="break-words text-left font-medium text-accent hover:underline">📎 {f.name}</button>
      : <span className="text-muted">📎 File removed</span>;
  };

  // The image review's versions: every image sent, then one uploaded since, if any.
  const sent = image ? sentImages(versions) : [];
  // Only images still on the review are listed; one that was removed keeps its
  // number out of use, so Version 2 stays Version 2.
  const liveImageIds = new Set(files.filter((f) => f.purpose === "image" && !f.removedAt).map((f) => f.id));
  const imageOptions = image ? [
    ...sent.map((fileId, i) => ({ fileId, label: `Version ${i + 1}` })).filter((o) => liveImageIds.has(o.fileId)),
    ...(doc.body && !sent.includes(doc.body) ? [{ fileId: doc.body, label: "New, not sent" }] : []),
  ] : [];
  const shownImage = viewingImage && imageOptions.some((o) => o.fileId === viewingImage) ? viewingImage : (doc.body || null);
  const shownFile = files.find((f) => f.id === shownImage);
  const shownUrl = shownFile ? thumbs[shownFile.path] : undefined;
  const openPins = comments.filter((c) => c.pin && !c.completedAt).length;
  // What removing the image shown will do, said before it happens.
  const removeMessage = (() => {
    if (!shownImage) return "";
    if (!sent.includes(shownImage)) return "Remove this image? It hasn't been sent, so the client never saw it.";
    const sentShown = imageOptions.filter((o) => sent.includes(o.fileId));
    const others = sentShown.filter((o) => o.fileId !== shownImage);
    const label = sentShown.find((o) => o.fileId === shownImage)?.label ?? "this version";
    const pins = comments.filter((c) => c.pin?.fileId === shownImage).length;
    const after = sentShown.at(-1)?.fileId !== shownImage
      ? "They keep seeing the newest version."
      : others.length ? `They'll see ${others[others.length - 1].label} instead.` : "They'll have no image to review until you send one.";
    return `Remove ${label}? The client stops seeing it${pins ? `, and its ${pins === 1 ? "pin is" : `${pins} pins are`} deleted` : ""}. ${after}`;
  })();

  const copyLinkButton = link?.live && link.copyable
    ? <button onClick={() => void copyLink()} disabled={busy !== null} className={quiet}>Copy link</button>
    : null;
  const headerActions = (
    <>
      {onEmailClient && doc.version > 0 && (
        <button onClick={() => void emailClient()} disabled={busy !== null} className={quiet}>{busy === "email" ? "Opening…" : "Email client"}</button>
      )}
      {copyLinkButton}
    </>
  );

  const meta = [
    doc.version ? (image ? "Sent" : `Version ${doc.version}`) : image && !doc.body ? "No image yet" : "Not sent yet",
    doc.version > 0 && link ? `Link ${link.live ? "on" : "off"}` : null,
    doc.version > 0 ? (doc.clientViewedAt ? `Viewed ${timeAgo(doc.clientViewedAt)}` : "Not viewed yet") : null,
    openPins ? `${openPins} open ${openPins === 1 ? "pin" : "pins"}` : null,
    activeFiles.length ? `${activeFiles.length} ${activeFiles.length === 1 ? "file" : "files"}` : null,
    `Edited ${timeAgo(doc.updatedAt)}`,
  ].filter(Boolean).join(" · ");

  const icon = image ? "🖼️" : "📄";
  const row = (
    <WorkItemRow tone={kind} icon={icon} title={name} badge={badge} meta={meta} actions={copyLinkButton}
      onOpen={() => switchView({ full: true })} />
  );
  if (!visible) return <>{row}{deletedLine}</>;

  const saveLabel = saveState === "unsaved" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : `Edited ${timeAgo(doc.updatedAt)}`;

  // One history, newest first: sends and client versions, the team's saved
  // drafts, and files coming and going, each with who and when. "What changed"
  // compares a text entry with the text entry before it, whichever kind it was.
  // An image review has no text to compare: its entries only say what happened.
  type Entry = { key: string; at: string; title: string; who: string | null; body?: string; restore?: Record<string, unknown>; restored?: string };
  const timeline: Entry[] = [
    ...versions.map((v): Entry => image
      ? { key: v.id, at: v.createdAt, title: v.kind === "sent" ? `Version ${sent.indexOf(v.body) + 1}: Sent to client` : KIND_LABEL.image[v.kind], who: v.authorLabel }
      : { key: v.id, at: v.createdAt, title: `Version ${v.version}: ${KIND_LABEL.doc[v.kind]}`, who: v.authorLabel, body: v.body, restore: { restoreVersion: v.version }, restored: `Version ${v.version} is back.` }),
    ...(image ? [] : checkpoints.map((c): Entry => ({ key: c.id, at: c.createdAt, title: "Saved draft", who: c.authorLabel, body: c.body, restore: { restoreCheckpoint: c.id }, restored: "That draft is back." }))),
    ...files.map((f): Entry => ({ key: `${f.id}:added`, at: f.createdAt, title: `${f.purpose === "image" ? "Uploaded" : "Added"} ${f.name}`, who: f.addedByLabel })),
    ...files.filter((f) => f.removedAt).map((f): Entry => ({ key: `${f.id}:removed`, at: f.removedAt!, title: `Removed ${f.name}`, who: f.removedByLabel })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const shownTimeline = allHistory ? timeline : timeline.slice(0, HISTORY_PREVIEW);

  const titleInput = (
    <input value={titleDraft}
      onChange={(e) => { const value = e.target.value; setTitleDraft(value); titleCommit.schedule(() => { void saveTitle(value); }); }}
      onBlur={() => titleCommit.flush()}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      placeholder={task.title} aria-label={`${image ? "Image review" : "Document"} name`} maxLength={200}
      className="w-full rounded-md bg-transparent px-1 py-0.5 text-[22px] font-bold outline-none placeholder:text-foreground hover:bg-background focus:bg-background" />
  );

  const imageArticle = (
    <article className="rounded-2xl border bg-surface p-4 shadow-sm sm:p-6">
      <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} className="hidden"
        onChange={(e) => { if (e.target.files) void uploadImage(e.target.files); e.target.value = ""; }} />
      {!doc.body ? (
        <FileDropLine label="Image" count={0} busy={adding} disabled={locked} onFiles={(list) => void uploadImage(list)}>
          <p className="py-8 text-center text-[16px] text-muted">Add the image your client should review. They click any spot on it to leave a numbered comment.</p>
        </FileDropLine>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <ImageVersionPicker options={imageOptions} value={shownImage} onChange={(id) => { setViewingImage(id); setPinDraft(null); }} />
            </div>
            {!locked && shownImage && (
              <button onClick={() => void removeImage(shownImage, removeMessage)} disabled={adding || busy !== null}
                className={`${quiet} hover:text-danger`}>
                {busy === "remove" ? "Removing…" : "Remove this version"}
              </button>
            )}
            {!locked && (
              <button onClick={() => imageInput.current?.click()} disabled={adding} className={quiet}>
                {adding ? "Uploading…" : "Upload new version"}
              </button>
            )}
          </div>
          {shownUrl ? (
            <ImagePinBoard src={shownUrl} alt={shownFile?.name ?? name} comments={comments} fileId={shownImage}
              pending={pinDraft} activeId={focusedComment} onPinClick={setFocusedComment}
              onPlace={locked || !shownImage ? undefined : (spot) => setPinDraft({ fileId: shownImage, ...spot, number: nextPin(comments, shownImage) })} />
          ) : (
            <p className="py-10 text-center text-[16px] text-muted">Loading the image…</p>
          )}
        </>
      )}
    </article>
  );

  // Full screen puts Files and History in a right column beside the writing
  // (Derek, 2026-09-11); in place they stack under it, since the task column is narrow.
  const content = (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
      {!image && clientCrossed && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft/40 px-4 py-3 text-[16px]">
          <span className="min-w-0 flex-1">{clientCrossed.authorLabel ?? "The client"} sent changes while you had unsent edits.</span>
          <button onClick={() => void patchDoc({ restoreVersion: clientCrossed.version }, "Their version is in. Send it when it's ready.")} className="font-semibold text-accent hover:underline">Use their version</button>
          <button onClick={() => setClientCrossed(null)} className="font-medium text-muted hover:underline">Keep mine</button>
        </div>
      )}
      {locked && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-[16px]" style={{ background: STATUS_META.approved.chip, color: STATUS_META.approved.dot }}>
          <span className="min-w-0 flex-1">
            {completed
              ? `This ${image ? "image" : "document"} is completed. Reopen it to make changes.`
              : image
                ? "The client approved this image. Reopen it to make changes."
                : <>The client approved {doc.approvedVersion ? `version ${doc.approvedVersion}` : "this document"}. Reopen it to make changes.</>}
          </span>
          <button onClick={() => void patchDoc({ reopen: true }, "Reopened. Send your changes when they're ready.")} className={quiet}>Reopen for changes</button>
        </div>
      )}

      {image ? imageArticle : (
        <article className="rounded-2xl border bg-surface p-5 shadow-sm sm:p-8">
          <RichTextEditor key={`doc-${doc.id}-${nonce}`} value={seed ?? doc.body} editable={!locked} variant="doc"
            placeholder="Write the content for your client…"
            highlights={comments.filter((c) => c.quote && !c.completedAt).map((c) => ({ id: c.id, quote: c.quote as string }))}
            activeHighlightId={focusedComment} onHighlightClick={setFocusedComment} onSelectionComment={setQuoteDraft}
            onChange={(html) => { latestHtml.current = html; setSaveState("unsaved"); commit.schedule(() => { void save(html); }); }} />
        </article>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {needsSend && (
          <button onClick={send} disabled={busy !== null}
            className="rounded-lg bg-accent px-6 py-2.5 text-[16px] font-semibold text-white disabled:opacity-50">
            {busy === "send" ? "Sending…" : doc.version === 0 ? "Send for review" : image ? "Send new version" : "Send changes"}
          </button>
        )}
        {!image && !locked && <button onClick={() => void saveDraft()} disabled={busy !== null || saveState === "saving"} className={quiet}>Save draft</button>}
        {/* When it last saved sits beside Save draft (Derek, 2026-09-11). */}
        {!image && !locked && <span className="text-[16px] text-muted">{saveLabel}{needsSend ? "" : " · Everything here has been sent"}</span>}
        {image && !locked && doc.body && !needsSend && <span className="text-[16px] text-muted">Everything here has been sent</span>}
        <button onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen} className={`ml-auto ${quiet}`}>
          {historyOpen ? "Hide history" : `History${timeline.length ? ` · ${timeline.length}` : ""}`}
        </button>
      </div>

      {historyOpen && (
        <section className="mt-3 rounded-xl border bg-surface px-4 py-2.5">
          {timeline.length === 0 && <p className="text-[16px] text-muted">{image ? "Uploads, sends, client answers and files" : "Saves, sends, client changes and files"} show up here with who did them.</p>}
          <div className="mt-1.5 space-y-1.5">
            {shownTimeline.map((entry) => {
              const i = timeline.indexOf(entry);
              const previous = entry.body === undefined ? undefined : timeline.slice(i + 1).find((e) => e.body !== undefined);
              const open = openEntry === entry.key;
              const d = open && previous?.body !== undefined && entry.body !== undefined ? diffDocText(previous.body, entry.body) : null;
              const changed = !!d && d.parts.some((p) => p.type !== "same");
              return (
                <div key={entry.key} className="rounded-lg border px-3 py-2">
                  <button onClick={() => entry.body !== undefined && setOpenEntry(open ? null : entry.key)}
                    className={`flex w-full flex-wrap items-center gap-x-2 text-left text-[16px] ${entry.body === undefined ? "cursor-default" : ""}`}>
                    <span className="font-semibold">{entry.title}</span>
                    {entry.who && <span className="text-muted">by {entry.who}</span>}
                    <span className="text-muted">{timeAgo(entry.at)}</span>
                  </button>
                  {open && (
                    <div className="mt-2">
                      {!previous ? (
                        <p className="text-[16px] text-muted">The first saved text, so there is nothing to compare yet.</p>
                      ) : d?.formattingOnly ? (
                        <p className="text-[16px] text-muted">Only the formatting changed.</p>
                      ) : !changed ? (
                        <p className="text-[16px] text-muted">No changes to the text.</p>
                      ) : (
                        <div className="whitespace-pre-wrap text-[16px] leading-relaxed">
                          {d!.parts.map((p, k) => p.type === "same"
                            ? <span key={k}>{p.text}</span>
                            : p.type === "added"
                              ? <ins key={k} className="rounded bg-success/15 px-0.5 text-success no-underline">{p.text}</ins>
                              : <del key={k} className="rounded bg-danger/10 px-0.5 text-danger">{p.text}</del>)}
                        </div>
                      )}
                      {!locked && entry.restore && (
                        <button onClick={() => void patchDoc(entry.restore!, `${entry.restored} Send it when it's ready.`)}
                          className="mt-2 text-[16px] font-semibold text-accent hover:underline">Use this version</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {timeline.length > HISTORY_PREVIEW && (
            <button onClick={() => setAllHistory((a) => !a)} className="mt-1.5 text-[16px] font-medium text-accent hover:underline">
              {allHistory ? "Show less" : `Show all ${timeline.length}`}
            </button>
          )}
        </section>
      )}

      </div>
      {/* Files and Comments stay beside the writing as it scrolls (Derek, 2026-09-11). */}
      <div className="space-y-3 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto">
        {/* An image review has no Files box: the image uploads on the left and a
            file rides on a comment (Derek, 2026-09-12: "we don't need upload files
            here since we can do it on the left"). */}
        {!image && (
          <FileDropLine label="Files" count={activeFiles.length} busy={adding} disabled={locked} onFiles={(list) => void addFiles(list)}>
            {previewImages.length > 0 && <ImageThumbGrid images={previewImages} onOpen={setLightbox} />}
            {activeFiles.length > 0 && (
              <ul className="mt-1.5 divide-y">
                {activeFiles.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[16px]">
                    <button onClick={() => openFileOrPreview(f)} className="min-w-0 break-words text-left font-medium text-accent hover:underline">{f.name}</button>
                    <span className="text-muted">{formatFileSize(f.sizeBytes)} · {f.addedByLabel ?? "Someone"}</span>
                    {!locked && <button onClick={() => void removeFile(f)} className="ml-auto text-muted hover:text-danger hover:underline">Remove</button>}
                  </li>
                ))}
              </ul>
            )}
          </FileDropLine>
        )}
        <CommentThread comments={image ? commentsFor(comments, shownImage) : comments} onPost={postComment} when={timeAgo} viewer="team"
          isMine={(c) => !!meId && comments.find((x) => x.id === c.id)?.authorId === meId}
          canDelete={() => true}
          onEdit={(id, body) => changeComment(id, { body })}
          onToggleDone={(id, done) => changeComment(id, { done })}
          onDelete={removeComment}
          quote={image ? null : quoteDraft} pinDraft={image ? pinDraft?.number ?? null : null}
          onClearQuote={() => { setQuoteDraft(null); setPinDraft(null); }}
          placeholder={image ? "Write a comment, or click the image to drop a numbered pin…" : undefined}
          onAttach={locked ? undefined : attachFile} renderAttachment={renderAttachment}
          focusedId={focusedComment} onQuoteClick={setFocusedComment} />
      </div>
    </div>
  );

  return (
    <>
      {row}
      {deletedLine}
      {full && (
        <WorkItemWindow icon={icon} title={titleInput} badge={stageSelect} actions={headerActions} onClose={() => switchView({ full: false })}>
          {content}
          {/* Deleting lives only here, small and at the very end (Derek, 2026-09-11). */}
          <div className="mt-12 flex justify-end border-t pt-4">
            <button onClick={() => void deleteDocument()} disabled={busy !== null} className="text-[16px] text-muted hover:text-danger hover:underline disabled:opacity-50">
              {busy === "delete" ? "Deleting…" : `Delete ${what}`}
            </button>
          </div>
        </WorkItemWindow>
      )}
      {lightbox !== null && previewImages[lightbox] && (
        <ImageLightbox images={previewImages} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}
