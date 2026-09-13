"use client";

// The client document on a task: the team writes it, sends the client a private
// link (no login), and sees what the client changed or approved. See
// supabase/task-documents.sql and src/lib/taskDocumentServer.ts.
//
// kind "image" is the task's image review and kind "page" its web page review
// (Derek, 2026-09-12, src/lib/reviewKinds.ts). Both keep versions as files: the
// team uploads an image, or pastes or uploads a page, the client leaves numbered
// pins, and asks for changes or approves. A revised version keeps the old ones and
// their pins a click away. On a page the client (and the team) can also reword
// text; the page itself only ever shows in a sandboxed frame (PageReviewFrame).
// Everything else here is shared with the document: the link, stages, files,
// comments, history, the review email and delete.
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
import { diffDocText, diffText, summarizeDocChanges, summarizeTextChanges } from "@/lib/docDiff";
import { addDocFiles, uploadSharedFile } from "@/lib/docFileUpload";
import { publishedFiles, type PinAnchor } from "@/lib/reviewPins";
import { commentHint, isFileKind, kindInSentence, kindNewName, kindQuery, kindTitle, kindWhat } from "@/lib/reviewKinds";
import { mergeEdits, PAGE_MAX_BYTES, PAGE_TOO_BIG, type FrameMode, type PageEdit } from "@/lib/pageFrameProtocol";
import { formatFileSize, isPreviewableImage } from "@/lib/uploadTypes";
import { RichTextEditor } from "./RichTextEditor";
import { useDebouncedCommit } from "./useDebouncedCommit";
import { PageReviewFrame, deviceForWidth, type PageDevice } from "./PageReviewFrame";
import { ActionMenu } from "./ActionMenu";
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
// One set of history labels for every kind. A client answer "sent changes" when it
// carries their own (new text, a reworded page) and "asked for changes" when it only
// points at their comments, the same words as the task's activity line.
const VERSION_LABEL: Record<TaskDocumentVersion["kind"], string> = { sent: "Sent to client", client_submitted: "Client sent changes", client_approved: "Client approved" };
const ASKED_LABEL = "Client asked for changes";
const KIND_ICON: Record<TaskDocumentKind, string> = { doc: "📄", image: "🖼️", page: "🌐" };
const HISTORY_PREVIEW = 5;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const PAGE_ACCEPT = ".html,.htm,text/html";

type PinDraft = { fileId: string; x: number; y: number; anchor: PinAnchor | null; number: number };

const docApi = (taskId: string, kind: TaskDocumentKind, path: string, init?: RequestInit) =>
  authedFetch(`/api/tasks/${encodeURIComponent(taskId)}/document${path}${kindQuery(kind)}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

export function TaskDocument({ task, kind = "doc", onPatch, pushToast, startNonce, onPresence, meId, onEmailClient }: {
  task: Task;
  /** "image" for the task's image review, "page" for its web page review. */
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
  /** Bumped by the line's chip: start it if there is none, then show it. */
  startNonce: number;
  /** Tells the drawer whether a document exists, so it can hide the chip. */
  onPresence: (exists: boolean) => void;
}) {
  const image = kind === "image";
  const page = kind === "page";
  const versioned = isFileKind(kind);
  const what = kindWhat(kind);
  const title = kind === "doc" ? "Document" : kindTitle(kind);
  const titleInSentence = kind === "doc" ? "document" : kindInSentence(kind);
  const api = (path: string, init?: RequestInit) => docApi(task.id, kind, path, init);
  const pageApi = (query: string, init?: RequestInit) =>
    authedFetch(`/api/tasks/${encodeURIComponent(task.id)}/document/page${kindQuery("page")}${query}`, init);
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
  // Image and page reviews: the pin dropped for the next comment, and the version
  // looked at (null follows the newest).
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [viewingVersion, setViewingVersion] = useState<string | null>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  // Web page review: the frame for the version shown, how a click works in it, its
  // width, the team's own rewording not saved yet, a pin to bring into view, pasted
  // code, and each version's words for the History diff.
  const [pageFrame, setPageFrame] = useState<{ fileId: string; url: string } | null>(null);
  const [frameNonce, setFrameNonce] = useState(0);
  const [pageMode, setPageMode] = useState<FrameMode>("comment");
  const [pageDevice, setPageDevice] = useState<PageDevice>("desktop");
  const [pageEdits, setPageEdits] = useState<{ fileId: string; edits: PageEdit[] }>({ fileId: "", edits: [] });
  const [pageFocus, setPageFocus] = useState<{ id: string; n: number } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [pageTexts, setPageTexts] = useState<Record<string, string>>({});
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
    // An image or page review numbers its versions by file, so the line needs them to say "Version N".
    if (isFileKind(kind)) void fetchTaskDocumentVersions(fresh.id).then(setVersions);
    // A client's comment logs an event on the task too, so it arrives here the same way.
    void fetchTaskDocumentComments(fresh.id).then(setComments);
    if (kind !== "image" && previous !== null && fresh.version > previous) {
      const latest = (await fetchTaskDocumentVersions(fresh.id))[0];
      if (latest && latest.kind !== "sent") {
        // The client published. Show their version, unless the team is mid edit:
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

  // A name the AI gave the review on its first content shows in the name box,
  // unless someone has typed one there (reviewAutoName.ts).
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (doc?.title && !titleDraft.trim()) setTitleDraft(doc.title); }, [doc?.title]);

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

  // The versions of an image or page review: every file published, then one added
  // since, if any. A removed version keeps its number out of use, so Version 2
  // stays Version 2.
  const sent = versioned ? publishedFiles(versions) : [];
  const liveVersionIds = new Set(files.filter((f) => f.purpose !== "file" && !f.removedAt).map((f) => f.id));
  const versionOptions = versioned && doc ? [
    ...sent.map((fileId, i) => ({ fileId, label: `Version ${i + 1}` })).filter((o) => liveVersionIds.has(o.fileId)),
    ...(doc.body && !sent.includes(doc.body) ? [{ fileId: doc.body, label: "New, not sent" }] : []),
  ] : [];
  const shownFileId = viewingVersion && versionOptions.some((o) => o.fileId === viewingVersion) ? viewingVersion : (doc?.body || null);

  const readJson = async (res: Response) => res.json().catch(() => ({} as Record<string, unknown>));
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };

  // The frame for the page version shown, fetched again when it expires or the page navigates.
  const pageFileId = page && visible ? shownFileId : null;
  useEffect(() => {
    if (!pageFileId) return;
    let cancelled = false;
    void pageApi(`&fileId=${encodeURIComponent(pageFileId)}`).then(async (res) => {
      const j = await readJson(res);
      if (cancelled) return;
      if (res.ok) setPageFrame({ fileId: pageFileId, url: j.frameUrl as string });
      else pushToast((j.error as string) ?? "Could not show the page.");
    });
    return () => { cancelled = true; };
  }, [pageFileId, frameNonce]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!res.ok) { pushToast((j.error as string) ?? `Could not start the ${titleInSentence}.`); return null; }
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

  // After a new version file became the one to send next.
  const afterNewVersion = async (document: unknown, message: string) => {
    setDoc(rowToTaskDocument(document));
    setViewingVersion(null);
    setPinDraft(null);
    await load();
    pushToast(message);
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
    const res = await api("", { method: "PATCH", body: JSON.stringify({ file: up.result.fileId }) });
    const j = await readJson(res);
    setAdding(false);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not use that image."); return; }
    await afterNewVersion(j.document, doc.version > 0 ? "New version uploaded. Send it when you're ready." : "Image added. Send it for review when you're ready.");
  };

  // A web page review: pasted code or an uploaded .html file becomes the version to
  // send next (Derek, 2026-09-12: "upload an html file or copy code").
  const addPage = async (html: string, name: string): Promise<boolean> => {
    if (!doc || adding) return false;
    if (new Blob([html]).size > PAGE_MAX_BYTES) { pushToast(PAGE_TOO_BIG); return false; }
    setAdding(true);
    const res = await pageApi("", { method: "POST", body: html, headers: { "Content-Type": "text/plain; charset=utf-8", "X-File-Name": encodeURIComponent(name) } });
    const j = await readJson(res);
    setAdding(false);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not add the page."); return false; }
    await afterNewVersion(j.document, doc.version > 0 ? "New version added. Send it when you're ready." : "Page added. Send it for review when you're ready.");
    return true;
  };
  const uploadPage = async (list: FileList) => {
    const file = Array.from(list).find((f) => /\.html?$/i.test(f.name));
    if (!file) { pushToast("Upload an .html file."); return; }
    if (file.size > PAGE_MAX_BYTES) { pushToast(PAGE_TOO_BIG); return; }
    await addPage(await file.text(), file.name);
  };
  const pastePage = async () => {
    if (await addPage(pasteDraft, "Pasted code.html")) { setPasteDraft(""); setPasteOpen(false); }
  };

  // The team's own rewording of the page shown, saved on the server as a new version.
  const shownEdits = pageEdits.fileId === shownFileId ? pageEdits.edits : [];
  const savePageEdits = async () => {
    if (!doc || !shownFileId || !shownEdits.length) return;
    setBusy("page-edits");
    const res = await pageApi("", { method: "POST", body: JSON.stringify({ baseFileId: shownFileId, edits: shownEdits }), headers: { "Content-Type": "application/json" } });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not save the text changes."); return; }
    setPageEdits({ fileId: "", edits: [] });
    await afterNewVersion(j.document, "Text changes saved as a new version. Send it when you're ready.");
  };
  const undoPageEdits = () => {
    setPageEdits({ fileId: "", edits: [] });
    setFrameNonce((n) => n + 1);
  };

  // The code of a page version, as plain text, for Copy code and Download.
  const pageCode = async (fileId: string): Promise<string | null> => {
    const res = await pageApi(`&fileId=${encodeURIComponent(fileId)}&as=code`);
    if (res.ok) return res.text();
    pushToast(((await readJson(res)).error as string) ?? "Could not get the code.");
    return null;
  };
  const copyCode = async () => {
    const code = shownFileId ? await pageCode(shownFileId) : null;
    if (code !== null) pushToast(await copy(code) ? "Code copied." : "Could not copy the code.");
  };
  const downloadCode = async () => {
    const code = shownFileId ? await pageCode(shownFileId) : null;
    if (code === null) return;
    const url = URL.createObjectURL(new Blob([code], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = files.find((f) => f.id === shownFileId)?.name ?? "page.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  // A page version's words for the History diff, fetched once each (a file never changes).
  const loadPageText = async (fileId: string) => {
    if (pageTexts[fileId] !== undefined) return;
    const res = await pageApi(`&fileId=${encodeURIComponent(fileId)}&as=text`);
    const j = await readJson(res);
    setPageTexts((t) => ({ ...t, [fileId]: res.ok ? (j.text as string) : "" }));
  };

  // Take a wrong version off (Derek, 2026-09-12: "a way to delete the image in case
  // it was the wrong one"). A sent one takes its pins with it, after a confirm.
  const removeVersion = async (fileId: string, message: string) => {
    if (!doc || !window.confirm(message)) return;
    setBusy("remove");
    const res = await api("", { method: "PATCH", body: JSON.stringify({ removeVersion: fileId }) });
    const j = await readJson(res);
    if (!res.ok) { setBusy(null); pushToast((j.error as string) ?? "Could not remove that version."); return; }
    // The versions list and pins change here and now, so a quick second click
    // never works from the list as it was before this removal.
    const at = new Date().toISOString();
    setFiles((fs) => fs.map((f) => (f.id === fileId ? { ...f, removedAt: at } : f)));
    setComments((cs) => cs.filter((c) => c.pin?.fileId !== fileId));
    setDoc(rowToTaskDocument(j.document));
    setViewingVersion(null);
    setPinDraft(null);
    await load();
    setBusy(null);
    pushToast("Version removed.");
  };

  // What the review email says changed: the words, on a document or an HTML review
  // (read out of both page versions); an image only has a new version.
  const reviewEmail = async (latestBody: string | undefined, beforeBody: string | undefined, count: number) => {
    if (!versioned) {
      return { text: htmlToText(latestBody ?? "").slice(0, 3000), changes: latestBody && beforeBody ? summarizeDocChanges(beforeBody, latestBody) : null };
    }
    if (!count) return { text: "", changes: null };
    const generic = `A new version of the ${what}.`;
    if (!page || !latestBody || !beforeBody || latestBody === beforeBody) return { text: "", changes: generic };
    const textOf = async (fileId: string) => {
      const res = await pageApi(`&fileId=${encodeURIComponent(fileId)}&as=text`);
      return res.ok ? ((await readJson(res)).text as string) : null;
    };
    const [before, after] = await Promise.all([textOf(beforeBody), textOf(latestBody)]);
    return { text: "", changes: (before !== null && after !== null ? summarizeTextChanges(before, after) : null) ?? generic };
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
    const earlier = publishedFiles(versions).length;
    await load();
    if (task.status !== "waiting") onPatch({ status: "waiting" });
    const url = j.url as string | null;
    const copied = !!url && await copy(url);
    // Straight into an email to the client, written with AI (Derek, 2026-09-11:
    // "when we send for review can it pop up a box to draft an email to the
    // client"). The document window closes so the email is the one on screen.
    const emailing = onEmailClient?.({ kind, url, name: doc.title.trim() || task.title, ...await reviewEmail(sentBody, previousBody, earlier) }) ?? false;
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
    // The last two versions the client saw: texts on a document, distinct files on an image or page review.
    const shown = publishedFiles(versions);
    const [latest, before] = versioned ? [shown.at(-1), shown.at(-2)] : [versions[0]?.body, versions[1]?.body];
    const opened = onEmailClient({
      kind, url, name: doc.title.trim() || task.title,
      ...await reviewEmail(latest ?? doc.body, before, shown.length > 1 ? 1 : 0),
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
    setViewingVersion(null);
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
    if (!doc || !window.confirm(`Delete this ${titleInSentence}? You can restore it from this task for 30 days, with its versions, files and comments. The client's link stops working until then.`)) return;
    commit.flush();
    titleCommit.flush();
    await saving.current;
    setBusy("delete");
    const res = await api("", { method: "DELETE" });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? `Could not delete the ${titleInSentence}.`); return; }
    setFull(false);
    versionRef.current = null;
    setDoc(null);
    setFiles([]);
    setComments([]);
    setLink(null);
    void fetchDeletedTaskDocuments(task.id, kind).then(setDeletedDocs);
    pushToast(`${title} deleted. Restore it from this task within 30 days.`);
  };

  const restoreDocument = async (documentId: string) => {
    setBusy("restore");
    const res = await api("/restore", { method: "POST", body: JSON.stringify({ documentId }) });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? `Could not restore the ${titleInSentence}.`); return; }
    versionRef.current = null;
    await load();
    pushToast(`${title} restored.`);
  };

  const postComment = async (body: string, quote?: string | null, attachmentFileId?: string | null) => {
    const pin = versioned && pinDraft ? { fileId: pinDraft.fileId, x: pinDraft.x, y: pinDraft.y, anchor: pinDraft.anchor } : null;
    const res = await api("/comments", { method: "POST", body: JSON.stringify({ body, quote: quote ?? null, pin, attachmentFileId: attachmentFileId ?? null }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not post the comment."); return false; }
    setComments((c) => [...c, { ...(j.comment as TaskDocumentComment), authorId: meId ?? null }]);
    setQuoteDraft(null);
    setPinDraft(null);
    if (j.emailedClient) pushToast("Comment posted. We emailed the client a link to it.");
    return true;
  };

  // A comment picked in the thread: shown on the image, or on the page at the width its pin was dropped at.
  const focusComment = (id: string) => {
    setFocusedComment(id);
    if (!page) return;
    const width = comments.find((c) => c.id === id)?.pin?.anchor?.width;
    if (width) setPageDevice(deviceForWidth(width));
    setPageFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
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
      <span>Deleted {titleInSentence}:</span>
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
    <select value={doc.status} onChange={(e) => void setStage(e.target.value as TaskDocumentStatus)} aria-label={`${title} stage`}
      className="cursor-pointer rounded-full border-0 px-3 py-1 text-[16px] font-semibold outline-none" style={{ background: tone.chip, color: tone.dot }}>
      {STAGES.map((s) => <option key={s} value={s}>{STATUS_VIEW[s].label}</option>)}
    </select>
  );
  // An image or page review has nothing to send until there is a version.
  const needsSend = !locked && (!versioned || !!doc.body) && (doc.version === 0 || doc.draftDirty);
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

  const shownFile = files.find((f) => f.id === shownFileId);
  const shownUrl = image && shownFile ? thumbs[shownFile.path] : undefined;
  const openComments = comments.filter((c) => !c.completedAt).length;
  // An image or page review's version numbers go by file, published order (reviewPins.ts).
  const fileVersion = (fileId: string) => sent.indexOf(fileId) + 1;
  const approvedFile = versioned ? versions.find((v) => v.version === doc.approvedVersion)?.body : undefined;
  const approvedNumber = versioned ? (approvedFile ? fileVersion(approvedFile) : 0) : doc.approvedVersion ?? 0;
  // What removing the version shown will do, said before it happens.
  const removeMessage = (() => {
    if (!shownFileId) return "";
    if (!sent.includes(shownFileId)) return `Remove this ${what}? It hasn't been sent, so the client never saw it.`;
    const sentShown = versionOptions.filter((o) => sent.includes(o.fileId));
    const others = sentShown.filter((o) => o.fileId !== shownFileId);
    const label = sentShown.find((o) => o.fileId === shownFileId)?.label ?? "this version";
    const pins = comments.filter((c) => c.pin?.fileId === shownFileId).length;
    const after = sentShown.at(-1)?.fileId !== shownFileId
      ? "They keep seeing the newest version."
      : others.length ? `They'll see ${others[others.length - 1].label} instead.` : `They'll have no ${what} to review until you send one.`;
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
    doc.version ? (!versioned ? `Version ${doc.version}` : sent.length ? `Version ${sent.length}` : "Sent") : versioned && !doc.body ? `No ${what} yet` : "Not sent yet",
    doc.version > 0 && link ? `Link ${link.live ? "on" : "off"}` : null,
    doc.version > 0 ? (doc.clientViewedAt ? `Viewed ${timeAgo(doc.clientViewedAt)}` : "Not viewed yet") : null,
    openComments ? `${openComments} open ${openComments === 1 ? "comment" : "comments"}` : null,
    activeFiles.length ? `${activeFiles.length} ${activeFiles.length === 1 ? "file" : "files"}` : null,
    `Edited ${timeAgo(doc.updatedAt)}`,
  ].filter(Boolean).join(" · ");

  const icon = KIND_ICON[kind];
  const row = (
    <WorkItemRow tone={kind} icon={icon} title={doc.title.trim() || kindNewName(kind)} badge={badge} meta={meta} actions={copyLinkButton}
      onOpen={() => switchView({ full: true })} />
  );
  if (!visible) return <>{row}{deletedLine}</>;

  const saveLabel = saveState === "unsaved" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : `Edited ${timeAgo(doc.updatedAt)}`;

  // One history, newest first: sends and client versions, the team's saved
  // drafts, and files coming and going, each with who and when. "What changed"
  // compares a text entry with the text entry before it, whichever kind it was;
  // on a page it compares the words read out of each version (fetched when opened).
  // An image has no text to compare, so its entries only say what happened.
  type Entry = { key: string; at: string; title: string; who: string | null; body?: string; pageFile?: string; restore?: Record<string, unknown>; restored?: string };
  const oldestFirst = [...versions].sort((a, b) => a.version - b.version);
  const versionLabel = (v: TaskDocumentVersion) => {
    if (v.kind !== "client_submitted") return VERSION_LABEL[v.kind];
    const earlier = oldestFirst.filter((x) => x.version < v.version);
    // Changes of their own: new text on a document, a file first seen here on a page.
    const own = versioned ? !earlier.some((x) => x.body === v.body) : earlier.at(-1)?.body.trim() !== v.body.trim();
    return own ? VERSION_LABEL.client_submitted : ASKED_LABEL;
  };
  const timeline: Entry[] = [
    ...versions.map((v): Entry => {
      if (!versioned) return { key: v.id, at: v.createdAt, title: `Version ${v.version}: ${versionLabel(v)}`, who: v.authorLabel, body: v.body, restore: { restoreVersion: v.version }, restored: `Version ${v.version} is back.` };
      const number = fileVersion(v.body);
      const entry: Entry = { key: v.id, at: v.createdAt, title: `Version ${number}: ${versionLabel(v)}`, who: v.authorLabel };
      if (!liveVersionIds.has(v.body)) return entry;
      return { ...entry, ...(page ? { pageFile: v.body } : {}), restore: { restoreVersion: v.version }, restored: `Version ${number} is back.` };
    }),
    ...(versioned ? [] : checkpoints.map((c): Entry => ({ key: c.id, at: c.createdAt, title: "Saved draft", who: c.authorLabel, body: c.body, restore: { restoreCheckpoint: c.id }, restored: "That draft is back." }))),
    ...files.map((f): Entry => ({ key: `${f.id}:added`, at: f.createdAt, title: `${f.purpose === "file" ? "Added" : "Uploaded"} ${f.name}`, who: f.addedByLabel })),
    ...files.filter((f) => f.removedAt).map((f): Entry => ({ key: `${f.id}:removed`, at: f.removedAt!, title: `Removed ${f.name}`, who: f.removedByLabel })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const shownTimeline = allHistory ? timeline : timeline.slice(0, HISTORY_PREVIEW);
  const comparable = (e: Entry) => e.body !== undefined || e.pageFile !== undefined;
  // An image version has no words to compare, but opens to bring it back.
  const openable = (e: Entry) => comparable(e) || !!e.restore;
  const openHistoryEntry = (entry: Entry, previous: Entry | undefined, open: boolean) => {
    setOpenEntry(open ? null : entry.key);
    if (open || !entry.pageFile) return;
    void loadPageText(entry.pageFile);
    if (previous?.pageFile) void loadPageText(previous.pageFile);
  };

  const titleInput = (
    <input value={titleDraft}
      onChange={(e) => { const value = e.target.value; setTitleDraft(value); titleCommit.schedule(() => { void saveTitle(value); }); }}
      onBlur={() => titleCommit.flush()}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      placeholder={kindNewName(kind)} aria-label={`${title} name`} maxLength={200}
      className="w-full rounded-md bg-transparent px-1 py-0.5 text-[22px] font-bold outline-none placeholder:text-foreground hover:bg-background focus:bg-background" />
  );

  const pasteBox = (
    <div className="mb-3 rounded-xl border bg-background p-3">
      <textarea value={pasteDraft} onChange={(e) => setPasteDraft(e.target.value)} rows={8} spellCheck={false}
        placeholder="Paste the page code here…" aria-label="Page code"
        className="w-full resize-y rounded-lg border bg-surface px-3 py-2 font-mono text-[16px] outline-none focus:border-accent" />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button onClick={() => void pastePage()} disabled={adding || !pasteDraft.trim()}
          className="rounded-lg bg-accent px-4 py-1.5 text-[16px] font-semibold text-white disabled:opacity-50">{adding ? "Adding…" : "Use this code"}</button>
        <button onClick={() => versionInput.current?.click()} disabled={adding} className={quiet}>Upload an .html file</button>
        {doc.body && <button onClick={() => { setPasteOpen(false); setPasteDraft(""); }} className={quiet}>Cancel</button>}
        <span className="text-[16px] text-muted">Up to 2 MB. Link images by web address.</span>
      </div>
    </div>
  );

  // One toolbar instead of a row of five buttons (Derek, 2026-09-13: "a little
  // messy"): New version and a More menu sit beside Desktop and Mobile, with
  // Remove this version one click in.
  const moreActions = shownFileId && (
    <ActionMenu label="⋯" title="More actions" items={[
      page && { label: "Copy code", onClick: () => void copyCode() },
      page && { label: "Download", onClick: () => void downloadCode() },
      !locked && { label: busy === "remove" ? "Removing…" : "Remove this version", danger: true, disabled: adding || busy !== null, onClick: () => void removeVersion(shownFileId, removeMessage) },
    ]} />
  );
  const pageActions = (
    <>
      {!locked && (
        <ActionMenu label={adding ? "Uploading…" : "New version ▾"} title="Add a new version of the page" items={[
          { label: "Paste code", onClick: () => setPasteOpen(true) },
          { label: "Upload an .html file", disabled: adding, onClick: () => versionInput.current?.click() },
        ]} />
      )}
      {moreActions}
    </>
  );

  const pageFrameView = shownFileId && (
    <PageReviewFrame
      actions={pageActions}
      frameUrl={pageFrame?.fileId === shownFileId ? pageFrame.url : null}
      onReload={() => setFrameNonce((n) => n + 1)}
      mode={pageMode} onMode={setPageMode} device={pageDevice} onDevice={setPageDevice}
      canEdit={!locked} canComment={!locked}
      pins={comments.filter((c) => c.pin && c.pin.fileId === shownFileId).map((c) => ({
        id: c.id, number: c.pin!.number, x: c.pin!.x, y: c.pin!.y, anchor: c.pin!.anchor, done: !!c.completedAt, active: c.id === focusedComment,
      }))}
      pending={pinDraft && pinDraft.fileId === shownFileId ? pinDraft : null}
      focus={pageFocus} edits={shownEdits}
      onPlace={(place) => setPinDraft({ fileId: shownFileId, ...place, number: nextPin(comments, shownFileId) })}
      onPinClick={setFocusedComment}
      onEdit={(edit) => setPageEdits((s) => ({ fileId: shownFileId, edits: mergeEdits(s.fileId === shownFileId ? s.edits : [], edit) }))} />
  );

  const versionArticle = (
    <article className="rounded-2xl border bg-surface p-5 shadow-sm sm:p-8">
      <input ref={versionInput} type="file" accept={page ? PAGE_ACCEPT : IMAGE_ACCEPT} className="hidden"
        onChange={(e) => { if (e.target.files) void (page ? uploadPage : uploadImage)(e.target.files); e.target.value = ""; }} />
      {!doc.body ? (
        page ? pasteBox : (
          <FileDropLine label="Image" count={0} busy={adding} disabled={locked} onFiles={(list) => void uploadImage(list)}>
            <p className="py-8 text-center text-[16px] text-muted">Add the image your client should review. They click any spot on it to leave a numbered comment.</p>
          </FileDropLine>
        )
      ) : (
        <>
          {(!page || versionOptions.length > 1) && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <ImageVersionPicker options={versionOptions} value={shownFileId} onChange={(id) => { setViewingVersion(id); setPinDraft(null); }} />
              </div>
              {!page && !locked && (
                <button onClick={() => versionInput.current?.click()} disabled={adding} className={quiet}>
                  {adding ? "Uploading…" : "Upload new version"}
                </button>
              )}
              {!page && moreActions}
            </div>
          )}
          {page && pasteOpen && !locked && pasteBox}
          {page ? pageFrameView : shownUrl ? (
            <ImagePinBoard src={shownUrl} alt={shownFile?.name ?? name} comments={comments} fileId={shownFileId}
              pending={pinDraft} activeId={focusedComment} onPinClick={setFocusedComment}
              onPlace={locked || !shownFileId ? undefined : (spot) => setPinDraft({ fileId: shownFileId, ...spot, anchor: null, number: nextPin(comments, shownFileId) })} />
          ) : (
            <p className="py-10 text-center text-[16px] text-muted">Loading the image…</p>
          )}
          {page && !locked && shownEdits.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-highlight/40 bg-highlight-soft/40 px-4 py-2.5 text-[16px]">
              <span className="min-w-0 flex-1">{shownEdits.length === 1 ? "1 text change" : `${shownEdits.length} text changes`} not saved yet.</span>
              <button onClick={() => void savePageEdits()} disabled={busy !== null}
                className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-white disabled:opacity-50">{busy === "page-edits" ? "Saving…" : "Save text changes"}</button>
              <button onClick={undoPageEdits} disabled={busy !== null} className={quiet}>Undo text changes</button>
            </div>
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
              ? `This ${what} is completed. Reopen it to make changes.`
              : `The client approved ${approvedNumber ? `version ${approvedNumber}` : `this ${what}`}. Reopen it to make changes.`}
          </span>
          <button onClick={() => void patchDoc({ reopen: true }, "Reopened. Send your changes when they're ready.")} className={quiet}>Reopen for changes</button>
        </div>
      )}

      {versioned ? versionArticle : (
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
            {busy === "send" ? "Sending…" : doc.version === 0 ? "Send for review" : "Send changes"}
          </button>
        )}
        {!versioned && !locked && <button onClick={() => void saveDraft()} disabled={busy !== null || saveState === "saving"} className={quiet}>Save draft</button>}
        {/* When it last saved sits beside Save draft (Derek, 2026-09-11). */}
        {!versioned && !locked && <span className="text-[16px] text-muted">{saveLabel}{needsSend ? "" : " · Everything here has been sent"}</span>}
        {versioned && !locked && doc.body && !needsSend && <span className="text-[16px] text-muted">Everything here has been sent</span>}
        <button onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen} className={`ml-auto ${quiet}`}>
          {historyOpen ? "Hide history" : `History${timeline.length ? ` · ${timeline.length}` : ""}`}
        </button>
      </div>

      {historyOpen && (
        <section className="mt-3 rounded-xl border bg-surface px-4 py-2.5">
          {timeline.length === 0 && <p className="text-[16px] text-muted">Sends, client answers, new versions and files show up here with who did them.</p>}
          <div className="mt-1.5 space-y-1.5">
            {shownTimeline.map((entry) => {
              const i = timeline.indexOf(entry);
              const previous = comparable(entry) ? timeline.slice(i + 1).find((e) => (entry.pageFile ? e.pageFile !== undefined : e.body !== undefined)) : undefined;
              const open = openEntry === entry.key;
              const d = open && previous?.body !== undefined && entry.body !== undefined ? diffDocText(previous.body, entry.body) : null;
              const pageBefore = previous?.pageFile ? pageTexts[previous.pageFile] : undefined;
              const pageAfter = entry.pageFile ? pageTexts[entry.pageFile] : undefined;
              const pageParts = open && pageBefore !== undefined && pageAfter !== undefined ? diffText(pageBefore, pageAfter) : null;
              const parts = d?.parts ?? pageParts;
              const changed = !!parts && parts.some((p) => p.type !== "same");
              const waiting = open && !!entry.pageFile && !!previous && !pageParts;
              return (
                <div key={entry.key} className="rounded-lg border px-3 py-2">
                  <button onClick={() => openable(entry) && openHistoryEntry(entry, previous, open)}
                    className={`flex w-full flex-wrap items-center gap-x-2 text-left text-[16px] ${openable(entry) ? "" : "cursor-default"}`}>
                    <span className="font-semibold">{entry.title}</span>
                    {entry.who && <span className="text-muted">by {entry.who}</span>}
                    <span className="text-muted">{timeAgo(entry.at)}</span>
                  </button>
                  {open && (
                    <div className="mt-2">
                      {!comparable(entry) ? null : !previous ? (
                        <p className="text-[16px] text-muted">The first {entry.pageFile ? "version" : "saved text"}, so there is nothing to compare yet.</p>
                      ) : waiting ? (
                        <p className="text-[16px] text-muted">Reading both versions…</p>
                      ) : d?.formattingOnly ? (
                        <p className="text-[16px] text-muted">Only the formatting changed.</p>
                      ) : !changed ? (
                        <p className="text-[16px] text-muted">{entry.pageFile ? "Only the code changed." : "No changes to the text."}</p>
                      ) : (
                        <div className="whitespace-pre-wrap text-[16px] leading-relaxed">
                          {parts!.map((p, k) => p.type === "same"
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
        {/* Image and page reviews have no Files box: the version uploads on the left
            and a file rides on a comment (Derek, 2026-09-12: "we don't need upload
            files here since we can do it on the left"). */}
        {!versioned && (
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
        <CommentThread comments={versioned ? commentsFor(comments, shownFileId) : comments} onPost={postComment} when={timeAgo} viewer="team"
          isMine={(c) => !!meId && comments.find((x) => x.id === c.id)?.authorId === meId}
          canDelete={() => true}
          onEdit={(id, body) => changeComment(id, { body })}
          onToggleDone={(id, done) => changeComment(id, { done })}
          onDelete={removeComment}
          quote={versioned ? null : quoteDraft} pinDraft={versioned ? pinDraft?.number ?? null : null}
          onClearQuote={() => { setQuoteDraft(null); setPinDraft(null); }}
          placeholder={commentHint(kind)}
          onAttach={locked ? undefined : attachFile} renderAttachment={renderAttachment}
          focusedId={focusedComment} onQuoteClick={focusComment} />
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
              {busy === "delete" ? "Deleting…" : `Delete ${titleInSentence}`}
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
