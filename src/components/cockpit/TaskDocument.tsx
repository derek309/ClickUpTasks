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
// text; the page itself only ever shows in a sandboxed frame (PageReviewStack). A
// version holds up to 10 images or pages, like two emails in one HTML review.
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
import { MAX_SET_IMAGES, frontFirst, imageLabel, parseImageSet, setFiles as imagesOf, type ImageSetItem } from "@/lib/imageSet";
import { countEdits, withPageEdit, PAGE_MAX_BYTES, PAGE_TOO_BIG, type FrameMode, type PageEditsByFile } from "@/lib/pageFrameProtocol";
import { VIDEO_WARN_BYTES, formatFileSize, isPreviewableImage, isReviewVideo } from "@/lib/uploadTypes";
import { RichTextEditor } from "./RichTextEditor";
import { useDebouncedCommit } from "./useDebouncedCommit";
import { deviceForWidth, type PageDevice } from "./PageReviewFrame";
import { PageReviewStack } from "./PageReviewStack";
import { VideoVersion } from "./ReviewVideo";
import { ActionMenu } from "./ActionMenu";
import {
  CommentThread, FileDropLine, ImageLightbox, ImagePinBoard, ImageThumbGrid, WorkItemBadge, WorkItemRow, WorkItemWindow,
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
const KIND_ICON: Record<TaskDocumentKind, string> = { doc: "📄", image: "🖼️", page: "🌐", video: "🎬" };
const HISTORY_PREVIEW = 5;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const PAGE_ACCEPT = ".html,.htm,text/html";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v";

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
  const video = kind === "video";
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
  // The comment the pointer is over, in the thread or on its pin, lit on both.
  const [hoveredComment, setHoveredComment] = useState<string | null>(null);
  // How far the video going up has got, 0 to 1, or null when none is. A video is
  // big enough that a spinner with no number reads as a hang (Derek, 2026-09-17).
  const [uploadShare, setUploadShare] = useState<number | null>(null);
  // Image and page reviews: the pin dropped for the next comment, and the version
  // looked at (null follows the newest).
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [viewingVersion, setViewingVersion] = useState<string | null>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  // Which image or page an upload (or paste) replaces in the working copy; null adds.
  const slotRef = useRef<number | null>(null);
  // HTML review: how a click works in its pages, their width, the team's own rewording
  // not saved yet (page by page), a pin to bring into view, pasted code, and each
  // version's words for the History diff. frameNonce reloads every page's frame.
  const [frameNonce, setFrameNonce] = useState(0);
  const [pageMode, setPageMode] = useState<FrameMode>("comment");
  const [pageDevice, setPageDevice] = useState<PageDevice>("desktop");
  const [pageEdits, setPageEdits] = useState<{ body: string; edits: PageEditsByFile }>({ body: "", edits: {} });
  const [pageFocus, setPageFocus] = useState<{ id: string; n: number } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  // The page pasted code replaces; null adds a page.
  const [pasteSlot, setPasteSlot] = useState<number | null>(null);
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

  // The versions of an image or page review: every body published (a file, or an
  // image review's set of images, imageSet.ts), then one made since, if any. A removed
  // version keeps its number out of use, so Version 2 stays Version 2.
  const sent = versioned ? publishedFiles(versions) : [];
  const liveVersionIds = new Set(files.filter((f) => f.purpose !== "file" && !f.removedAt).map((f) => f.id));
  const isLive = (body: string) => { const ids = imagesOf(body); return ids.length > 0 && ids.every((id) => liveVersionIds.has(id)); };
  const versionOptions = versioned && doc ? [
    ...sent.map((fileId, i) => ({ fileId, label: `Version ${i + 1}` })).filter((o) => isLive(o.fileId)),
    ...(doc.body && !sent.includes(doc.body) ? [{ fileId: doc.body, label: "New, not sent" }] : []),
  ] : [];
  const shownFileId = viewingVersion && versionOptions.some((o) => o.fileId === viewingVersion) ? viewingVersion : (doc?.body || null);

  const readJson = async (res: Response) => res.json().catch(() => ({} as Record<string, unknown>));
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };

  // A video version's link, signed here because the team is signed in. Hours, not
  // minutes: the player holds one link for the whole watch and seeks against it.
  const loadVideo = useCallback(async (fileId: string): Promise<string | null> => {
    const path = files.find((f) => f.id === fileId)?.path;
    return path ? await signedUrlForFile(path, 6 * 3600) : null;
  }, [files]);

  // One page's frame address; the stack asks for each page and again when one expires.
  const loadFrame = async (fileId: string): Promise<string | null> => {
    const res = await pageApi(`&fileId=${encodeURIComponent(fileId)}`);
    const j = await readJson(res);
    return res.ok ? (j.frameUrl as string) : null;
  };

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

  // A working copy holds up to 10 images or pages, shown stacked (Derek, 2026-09-14:
  // "upload both the front and back files in one"; 2026-09-16: two emails in one HTML
  // review). Every change saves the whole set, which makes it the version to send next.
  const itemWord = page ? "page" : "image";
  const saveImages = async (items: ImageSetItem[]): Promise<unknown | null> => {
    const res = await api("", { method: "PATCH", body: JSON.stringify({ images: items }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? `Could not save the ${itemWord}s.`); return null; }
    return j.document;
  };
  // Upload images: slot replaces that image and the others carry over; without it they
  // are added at the end (two dropped on an empty review are its Front and Back).
  const uploadImages = async (list: FileList, slot: number | null) => {
    if (!doc || adding) return;
    const current = parseImageSet(doc.body);
    const picked = frontFirst(Array.from(list).filter((f) => isPreviewableImage(f.name)));
    if (!picked.length) { pushToast("Upload a JPG, PNG, WebP or GIF image."); return; }
    const room = slot !== null ? 1 : MAX_SET_IMAGES - current.length;
    if (room <= 0) { pushToast(`A version holds up to ${MAX_SET_IMAGES} images.`); return; }
    const chosen = picked.slice(0, room);
    setAdding(true);
    const added: string[] = [];
    for (const file of chosen) {
      const up = await uploadSharedFile(file, (payload) => api("/files", { method: "POST", body: JSON.stringify({ ...payload, purpose: "image" }) }));
      if (!up.ok) { pushToast(up.error); break; }
      added.push(up.result.fileId as string);
    }
    const items = slot !== null && current[slot]
      ? current.map((item, i) => (i === slot ? { file: added[0], label: item.label } : item))
      : [...current, ...added.map((file) => ({ file, label: "" }))];
    const saved = added.length ? await saveImages(items) : null;
    setAdding(false);
    if (!saved) return;
    const done = slot !== null ? "Image replaced." : added.length > 1 ? `${added.length} images added.` : "Image added.";
    const left = picked.length > chosen.length && slot === null ? ` A version holds up to ${MAX_SET_IMAGES} images, so ${picked.length - chosen.length} ${picked.length - chosen.length === 1 ? "was" : "were"} left out.` : "";
    await afterNewVersion(saved, `${done} Send it when you're ready.${left}`);
  };
  // Upload videos, the same way as images. The warning above 200MB is the whole
  // guard against a master going up by accident (docs/video-review-plan.md): at
  // 720p nothing Derek sends a client is that big, and whatever goes up is what
  // the client downloads, so it costs storage and it costs them their data.
  const uploadVideos = async (list: FileList, slot: number | null) => {
    if (!doc || adding) return;
    const current = parseImageSet(doc.body);
    const picked = Array.from(list).filter((f) => isReviewVideo(f.name));
    if (!picked.length) { pushToast("Upload an MP4, MOV, WebM or M4V video."); return; }
    const room = slot !== null ? 1 : MAX_SET_IMAGES - current.length;
    if (room <= 0) { pushToast(`A version holds up to ${MAX_SET_IMAGES} videos.`); return; }
    const chosen = picked.slice(0, room);
    const big = chosen.find((f) => f.size > VIDEO_WARN_BYTES);
    if (big && !window.confirm(`${big.name} is ${formatFileSize(big.size)}. Review copies are 720p and much smaller than that, so this looks like a master. Upload it anyway?`)) return;
    setAdding(true);
    const added: string[] = [];
    for (const file of chosen) {
      setUploadShare(0);
      const up = await uploadSharedFile(file, (payload) => api("/files", { method: "POST", body: JSON.stringify({ ...payload, purpose: "video" }) }), "video", setUploadShare);
      if (!up.ok) {
        // Over the Supabase project's own upload limit, not ours: say where it is
        // set, because trying again never gets past it.
        pushToast(up.overLimit ? `${up.error} Raise the limit in Supabase under Storage, then Settings.` : up.error);
        break;
      }
      added.push(up.result.fileId as string);
    }
    setUploadShare(null);
    const items = slot !== null && current[slot]
      ? current.map((item, i) => (i === slot ? { file: added[0], label: item.label } : item))
      : [...current, ...added.map((file) => ({ file, label: "" }))];
    const saved = added.length ? await saveImages(items) : null;
    setAdding(false);
    if (!saved) return;
    const done = slot !== null ? "Video replaced." : added.length > 1 ? `${added.length} videos added.` : "Video added.";
    await afterNewVersion(saved, `${done} Send it when you're ready.`);
  };
  const relabelImage = async (index: number, label: string) => {
    const current = doc ? parseImageSet(doc.body) : [];
    if (!current[index] || current[index].label === label) return;
    const saved = await saveImages(current.map((item, i) => (i === index ? { ...item, label } : item)));
    if (saved) setDoc(rowToTaskDocument(saved));
  };
  // Swap an image or page with the one above or below (Derek, 2026-09-14: "reorder").
  // Default names follow the place, so the top of two is always Front; typed names and
  // pins move with their image.
  const moveImage = async (index: number, by: -1 | 1) => {
    const current = doc ? parseImageSet(doc.body) : [];
    const to = index + by;
    if (!current[index] || !current[to] || adding || busy !== null) return;
    const next = [...current];
    [next[index], next[to]] = [next[to], next[index]];
    setBusy("move");
    const saved = await saveImages(next);
    setBusy(null);
    if (saved) setDoc(rowToTaskDocument(saved));
  };
  const takeOutImage = async (index: number) => {
    const current = doc ? parseImageSet(doc.body) : [];
    if (current.length < 2 || !window.confirm(`Take ${itemLabel(current, index)} out of this version? Earlier versions keep it, with its pins.`)) return;
    const saved = await saveImages(current.filter((_, i) => i !== index));
    if (saved) await afterNewVersion(saved, `${page ? "Page" : video ? "Video" : "Image"} taken out. Send it when you're ready.`);
  };

  // An HTML review: pasted code or uploaded .html files join the working copy, or one
  // replaces the page at slot (Derek, 2026-09-12: "upload an html file or copy code").
  const addPages = async (pages: { html: string; name: string }[], slot: number | null): Promise<boolean> => {
    if (!doc || adding || !pages.length) return false;
    if (pages.some((p) => new Blob([p.html]).size > PAGE_MAX_BYTES)) { pushToast(PAGE_TOO_BIG); return false; }
    const room = slot !== null ? 1 : MAX_SET_IMAGES - parseImageSet(doc.body).length;
    if (room <= 0) { pushToast(`A version holds up to ${MAX_SET_IMAGES} pages.`); return false; }
    const chosen = pages.slice(0, room);
    setAdding(true);
    let saved: unknown = null;
    for (const p of chosen) {
      const res = await pageApi(slot !== null ? `&slot=${slot}` : "", { method: "POST", body: p.html, headers: { "Content-Type": "text/plain; charset=utf-8", "X-File-Name": encodeURIComponent(p.name) } });
      const j = await readJson(res);
      if (!res.ok) { pushToast((j.error as string) ?? "Could not add the page."); break; }
      saved = j.document;
    }
    setAdding(false);
    if (!saved) return false;
    const done = slot !== null ? "Page replaced." : !doc.body ? (chosen.length > 1 ? `${chosen.length} pages added.` : "Page added.") : chosen.length > 1 ? `${chosen.length} pages added.` : "Page added.";
    const left = pages.length > chosen.length ? ` A version holds up to ${MAX_SET_IMAGES} pages, so ${pages.length - chosen.length} ${pages.length - chosen.length === 1 ? "was" : "were"} left out.` : "";
    await afterNewVersion(saved, `${done} ${doc.version > 0 ? "Send it when you're ready." : "Send it for review when you're ready."}${left}`);
    return true;
  };
  const uploadPages = async (list: FileList, slot: number | null) => {
    const picked = Array.from(list).filter((f) => /\.html?$/i.test(f.name));
    if (!picked.length) { pushToast("Upload an .html file."); return; }
    if (picked.some((f) => f.size > PAGE_MAX_BYTES)) { pushToast(PAGE_TOO_BIG); return; }
    await addPages(await Promise.all((slot !== null ? picked.slice(0, 1) : picked).map(async (f) => ({ html: await f.text(), name: f.name }))), slot);
  };
  const openPaste = (slot: number | null) => { setPasteSlot(slot); setPasteOpen(true); };
  const pastePage = async () => {
    if (await addPages([{ html: pasteDraft, name: "Pasted code.html" }], pasteSlot)) { setPasteDraft(""); setPasteOpen(false); setPasteSlot(null); }
  };

  // The team's own rewording of the version shown, on any of its pages, saved on the
  // server as a new version.
  const shownEdits: PageEditsByFile = pageEdits.body === shownFileId ? pageEdits.edits : {};
  const shownEditCount = countEdits(shownEdits);
  const savePageEdits = async () => {
    if (!doc || !shownFileId || !shownEditCount) return;
    setBusy("page-edits");
    const res = await pageApi("", { method: "POST", body: JSON.stringify({ baseBody: shownFileId, edits: shownEdits }), headers: { "Content-Type": "application/json" } });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not save the text changes."); return; }
    setPageEdits({ body: "", edits: {} });
    await afterNewVersion(j.document, "Text changes saved as a new version. Send it when you're ready.");
  };
  const undoPageEdits = () => {
    setPageEdits({ body: "", edits: {} });
    setFrameNonce((n) => n + 1);
  };

  // The code of one page, as plain text, for Copy code and Download.
  const pageCode = async (fileId: string): Promise<string | null> => {
    const res = await pageApi(`&fileId=${encodeURIComponent(fileId)}&as=code`);
    if (res.ok) return res.text();
    pushToast(((await readJson(res)).error as string) ?? "Could not get the code.");
    return null;
  };
  const copyCode = async (fileId: string) => {
    const code = await pageCode(fileId);
    if (code !== null) pushToast(await copy(code) ? "Code copied." : "Could not copy the code.");
  };
  const downloadCode = async (fileId: string) => {
    const code = await pageCode(fileId);
    if (code === null) return;
    const url = URL.createObjectURL(new Blob([code], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = files.find((f) => f.id === fileId)?.name ?? "page.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  // A version's words, every page in order under its name, for the History diff and
  // the review email. Null when a page could not be read.
  const versionText = async (body: string): Promise<string | null> => {
    const items = parseImageSet(body);
    const texts = await Promise.all(items.map(async (item) => {
      const res = await pageApi(`&fileId=${encodeURIComponent(item.file)}&as=text`);
      return res.ok ? ((await readJson(res)).text as string) : null;
    }));
    if (texts.some((t) => t === null)) return null;
    return items.length > 1 ? texts.map((t, i) => `${imageLabel(items, i, "page")}\n${t}`).join("\n\n") : texts[0] ?? "";
  };

  // A version's words for the History diff, fetched once each (a version never changes).
  const loadPageText = async (body: string) => {
    if (pageTexts[body] !== undefined) return;
    const text = await versionText(body);
    setPageTexts((t) => ({ ...t, [body]: text ?? "" }));
  };

  // Take a wrong version off (Derek, 2026-09-12: "a way to delete the image in case
  // it was the wrong one"). A sent one takes its pins with it, after a confirm.
  // going: the files this takes off (on an image review, the images no other version uses).
  const removeVersion = async (target: string, going: string[], message: string) => {
    if (!doc || !window.confirm(message)) return;
    setBusy("remove");
    const res = await api("", { method: "PATCH", body: JSON.stringify({ removeVersion: target }) });
    const j = await readJson(res);
    if (!res.ok) { setBusy(null); pushToast((j.error as string) ?? "Could not remove that version."); return; }
    // The versions list and pins change here and now, so a quick second click
    // never works from the list as it was before this removal.
    const at = new Date().toISOString();
    setFiles((fs) => fs.map((f) => (going.includes(f.id) ? { ...f, removedAt: at } : f)));
    setComments((cs) => cs.filter((c) => !c.pin || !going.includes(c.pin.fileId)));
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
    const [before, after] = await Promise.all([versionText(beforeBody), versionText(latestBody)]);
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

  // The images or pages of the version shown, and which of them tells a pin apart.
  const shownItems = versioned ? parseImageSet(shownFileId) : [];
  const shownIds = shownItems.map((item) => item.file);
  const editingSet = versioned && !locked && !!doc.body && shownFileId === doc.body;
  const itemLabel = (items: ImageSetItem[], i: number) => imageLabel(items, i, page ? "page" : video ? "video" : "image");
  const imagePlace = (fileId: string) => {
    const i = shownItems.findIndex((item) => item.file === fileId);
    return i >= 0 && shownItems.length > 1 ? itemLabel(shownItems, i) : null;
  };
  const openComments = comments.filter((c) => !c.completedAt).length;
  // An image or page review's version numbers go by file, published order (reviewPins.ts).
  const fileVersion = (fileId: string) => sent.indexOf(fileId) + 1;
  const approvedFile = versioned ? versions.find((v) => v.version === doc.approvedVersion)?.body : undefined;
  const approvedNumber = versioned ? (approvedFile ? fileVersion(approvedFile) : 0) : doc.approvedVersion ?? 0;
  // What removing the version shown takes off: only the images or pages no other
  // version (or the working copy) uses; they go with their pins.
  const otherIds = new Set([...sent, doc.body].filter((body) => body && body !== shownFileId).flatMap(imagesOf));
  const goingIds = shownIds.filter((id) => !otherIds.has(id));
  // What removing the version shown will do, said before it happens.
  const removeMessage = (() => {
    if (!shownFileId) return "";
    const kept = goingIds.length < shownIds.length ? ` ${page ? "Pages" : "Images"} other versions use stay.` : "";
    if (!sent.includes(shownFileId)) return `Remove this version? It hasn't been sent, so the client never saw it.${kept}`;
    const sentShown = versionOptions.filter((o) => sent.includes(o.fileId));
    const others = sentShown.filter((o) => o.fileId !== shownFileId);
    const label = sentShown.find((o) => o.fileId === shownFileId)?.label ?? "this version";
    const pins = comments.filter((c) => c.pin && goingIds.includes(c.pin.fileId)).length;
    const after = sentShown.at(-1)?.fileId !== shownFileId
      ? "They keep seeing the newest version."
      : others.length ? `They'll see ${others[others.length - 1].label} instead.` : `They'll have no ${what} to review until you send one.`;
    return `Remove ${label}? The client stops seeing it${pins ? `, and its ${pins === 1 ? "pin is" : `${pins} pins are`} deleted` : ""}.${kept} ${after}`;
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
      if (!isLive(v.body)) return entry;
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

  const pasteSlotLabel = pasteOpen && pasteSlot !== null && shownItems[pasteSlot] ? itemLabel(shownItems, pasteSlot) : null;
  const pasteBox = (
    <div className="mb-3 rounded-xl border bg-background p-3">
      <textarea value={pasteDraft} onChange={(e) => setPasteDraft(e.target.value)} rows={8} spellCheck={false}
        placeholder={pasteSlotLabel ? `Paste the new code for ${pasteSlotLabel} here…` : "Paste the page code here…"} aria-label="Page code"
        className="w-full resize-y rounded-lg border bg-surface px-3 py-2 font-mono text-[16px] outline-none focus:border-accent" />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button onClick={() => void pastePage()} disabled={adding || !pasteDraft.trim()}
          className="rounded-lg bg-accent px-4 py-1.5 text-[16px] font-semibold text-white disabled:opacity-50">{adding ? "Adding…" : "Use this code"}</button>
        <button onClick={() => versionInput.current?.click()} disabled={adding} className={quiet}>{pasteSlotLabel ? "Upload an .html file" : "Upload .html files"}</button>
        {doc.body && <button onClick={() => { setPasteOpen(false); setPasteDraft(""); setPasteSlot(null); }} className={quiet}>Cancel</button>}
        <span className="text-[16px] text-muted">Up to 2 MB each. Link images by web address.{doc.body ? "" : " Two emails? Add the second one after this."}</span>
      </div>
    </div>
  );

  // Remove this version sits one click in, in the review bar's More menu (Derek,
  // 2026-09-13: "a little messy"). Copy code and Download belong to each page.
  // "Uploading… 42%" once there is a number to show, so a big file never looks stuck.
  const uploadLabel = uploadShare === null ? "Uploading…" : `Uploading… ${Math.round(uploadShare * 100)}%`;
  const moreActions = shownFileId && !locked && (
    <ActionMenu label="⋯" title="More actions" items={[
      { label: busy === "remove" ? "Removing…" : "Remove this version", danger: true, disabled: adding || busy !== null || !goingIds.length, onClick: () => void removeVersion(shownFileId, goingIds, removeMessage) },
    ]} />
  );

  // A name above each image or page, with one quiet menu instead of a row of buttons
  // (Derek, 2026-09-14 redesign). The working copy's can be renamed, replaced, moved
  // or taken out; an older version is read only. Every page can copy its code.
  const setItemHeader = (item: ImageSetItem, i: number) => {
    const label = itemLabel(shownItems, i);
    const menuItems = [
      page && { label: "Copy code", onClick: () => void copyCode(item.file) },
      page && { label: "Download", onClick: () => void downloadCode(item.file) },
      editingSet && !page && { label: video ? "Replace video" : "Replace image", disabled: adding, onClick: () => { slotRef.current = i; versionInput.current?.click(); } },
      editingSet && page && { label: "Replace with pasted code", disabled: adding, onClick: () => openPaste(i) },
      editingSet && page && { label: "Replace with an .html file", disabled: adding, onClick: () => { slotRef.current = i; setPasteOpen(false); versionInput.current?.click(); } },
      editingSet && shownItems.length > 1 && { label: "Move up", disabled: i === 0 || adding || busy !== null, onClick: () => void moveImage(i, -1) },
      editingSet && shownItems.length > 1 && { label: "Move down", disabled: i === shownItems.length - 1 || adding || busy !== null, onClick: () => void moveImage(i, 1) },
      editingSet && shownItems.length > 1 && { label: "Take out of this version", danger: true, disabled: adding, onClick: () => void takeOutImage(i) },
    ];
    if (!(shownItems.length > 1 || editingSet || page)) return null;
    return (
      <div className="mb-2 flex items-center gap-2">
        {editingSet ? (
          <input key={`${doc.body}:${i}`} defaultValue={item.label} maxLength={40} aria-label={`Name of ${label}`} title="Rename"
            placeholder={itemLabel(shownItems.map((x, n) => (n === i ? { ...x, label: "" } : x)), i)}
            onBlur={(e) => void relabelImage(i, e.currentTarget.value.trim())}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            className="-ml-2 min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-[16px] font-semibold outline-none placeholder:text-foreground hover:bg-surface hover:ring-1 hover:ring-border focus:bg-surface focus:ring-2 focus:ring-accent" />
        ) : (
          <h3 className="min-w-0 flex-1 text-[16px] font-semibold">{label}</h3>
        )}
        {menuItems.some(Boolean) && (
          <ActionMenu label="⋯" title={`${label} actions`}
            triggerClassName={`${quiet} opacity-60 transition group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(hover:none)]:opacity-100`}
            items={menuItems} />
        )}
      </div>
    );
  };

  const pageStack = shownFileId && (
    // Each page stacked with its own name, pins and rewording (Derek, 2026-09-16: two emails in one review).
    <PageReviewStack key={`${shownFileId}:${frameNonce}`}
      pages={shownItems.map((item, i) => ({ fileId: item.file, label: itemLabel(shownItems, i) }))}
      loadFrame={loadFrame}
      onLoadError={() => pushToast("Could not show the page.")}
      mode={pageMode} onMode={setPageMode} device={pageDevice} onDevice={setPageDevice}
      canEdit={!locked} canComment={!locked}
      pinsFor={(fileId) => comments.filter((c) => c.pin && c.pin.fileId === fileId).map((c) => ({
        id: c.id, number: c.pin!.number, x: c.pin!.x, y: c.pin!.y, anchor: c.pin!.anchor, done: !!c.completedAt, active: c.id === focusedComment,
      }))}
      pending={pinDraft}
      focus={pageFocus} edits={shownEdits}
      onPlace={(fileId, place) => setPinDraft({ fileId, ...place, number: nextPin(comments, fileId) })}
      onPinClick={setFocusedComment}
      onEdit={(fileId, edit) => setPageEdits((st) => ({ body: shownFileId, edits: withPageEdit(st.body === shownFileId ? st.edits : {}, fileId, edit) }))}
      header={(_, i) => setItemHeader(shownItems[i], i)} />
  );

  const versionArticle = (
    <article className={doc.body ? "min-w-0" : "rounded-2xl border bg-surface p-5 shadow-sm sm:p-8"}>
      <input ref={versionInput} type="file" accept={page ? PAGE_ACCEPT : video ? VIDEO_ACCEPT : IMAGE_ACCEPT} className="hidden" multiple
        onChange={(e) => { if (e.target.files) void (page ? uploadPages(e.target.files, pasteOpen ? pasteSlot : slotRef.current) : video ? uploadVideos(e.target.files, slotRef.current) : uploadImages(e.target.files, slotRef.current)); e.target.value = ""; }} />
      {!doc.body ? (
        page ? pasteBox : video ? (
          <FileDropLine label="Video" count={0} busy={adding} busyLabel={uploadLabel} disabled={locked} onFiles={(list) => void uploadVideos(list, null)}>
            <p className="py-8 text-center text-[16px] text-muted">Add the video your client should review. Send a 720p copy, not the master: whatever goes up is what they download to watch it.</p>
          </FileDropLine>
        ) : (
          <FileDropLine label="Images" count={0} busy={adding} disabled={locked} onFiles={(list) => void uploadImages(list, null)}>
            <p className="py-8 text-center text-[16px] text-muted">Add the image your client should review, or up to {MAX_SET_IMAGES} at once, like a postcard&apos;s front and back. They click any spot on an image to leave a numbered comment.</p>
          </FileDropLine>
        )
      ) : (
        <>
          {page && pasteOpen && !locked && pasteBox}
          {page ? pageStack : video ? (
            <div className="space-y-8">
              {shownItems.map((item, i) => {
                const f = files.find((x) => x.id === item.file);
                const label = itemLabel(shownItems, i);
                return (
                  <section key={`${shownFileId}:${item.file}`} aria-label={label} data-image-anchor={item.file} className="group">
                    {setItemHeader(item, i)}
                    <VideoVersion fileId={item.file} label={f?.name ?? label} load={loadVideo} />
                  </section>
                );
              })}
            </div>
          ) : (
            // Stacked, each with its own name and pins (Derek, 2026-09-14).
            <div className="space-y-8">
              {shownItems.map((item, i) => {
                const f = files.find((x) => x.id === item.file);
                const url = f ? thumbs[f.path] : undefined;
                const label = itemLabel(shownItems, i);
                return (
                  <section key={`${shownFileId}:${item.file}`} aria-label={label} data-image-anchor={item.file} className="group">
                    {setItemHeader(item, i)}
                    {url ? (
                      <ImagePinBoard src={url} alt={f?.name ?? label} comments={comments} fileId={item.file}
                        pending={pinDraft} activeId={focusedComment} onPinClick={setFocusedComment} hoverId={hoveredComment} onPinHover={setHoveredComment}
                        onPlace={locked ? undefined : (spot) => setPinDraft({ fileId: item.file, ...spot, anchor: null, number: nextPin(comments, item.file) })} />
                    ) : (
                      <p className="py-10 text-center text-[16px] text-muted">Loading the image…</p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {page && !locked && shownEditCount > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-highlight/40 bg-highlight-soft/40 px-4 py-2.5 text-[16px]">
              <span className="min-w-0 flex-1">{shownEditCount === 1 ? "1 text change" : `${shownEditCount} text changes`} not saved yet.</span>
              <button onClick={() => void savePageEdits()} disabled={busy !== null}
                className="rounded-lg bg-accent px-4 py-1.5 font-semibold text-white disabled:opacity-50">{busy === "page-edits" ? "Saving…" : "Save text changes"}</button>
              <button onClick={undoPageEdits} disabled={busy !== null} className={quiet}>Undo text changes</button>
            </div>
          )}
        </>
      )}
    </article>
  );

  const historyPanel = historyOpen && (
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
  );

  // One bar for the whole image or HTML review (Derek, 2026-09-14 redesign): which
  // version, where it stands, and the few actions that belong to all its images or pages.
  const lastSent = [...versions].filter((v) => v.kind === "sent").sort((a, b) => b.version - a.version)[0];
  const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const barStatus = needsSend
    ? (doc.version ? "Changes not sent" : "Not sent yet")
    : [lastSent ? `Sent ${shortDate(lastSent.createdAt)}` : null, doc.clientViewedAt ? `Viewed ${timeAgo(doc.clientViewedAt)}` : null].filter(Boolean).join(" · ");
  const reviewBar = versioned && doc.body ? (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-4 py-2.5 shadow-sm">
      {versionOptions.length > 1 ? (
        <select value={shownFileId ?? ""} onChange={(e) => { setViewingVersion(e.target.value); setPinDraft(null); }} aria-label="Version shown"
          className="cursor-pointer rounded-lg border bg-surface px-3 py-1.5 text-[16px] font-semibold outline-none focus:border-accent">
          {versionOptions.map((o) => <option key={o.fileId} value={o.fileId}>{o.label}</option>)}
        </select>
      ) : (
        <span className="rounded-lg border px-3 py-1.5 text-[16px] font-semibold">{versionOptions[0]?.label ?? "Version 1"}</span>
      )}
      {barStatus && (
        <span className="flex items-center gap-2 text-[16px] text-muted">
          <span aria-hidden className={`h-2 w-2 rounded-full ${needsSend ? "bg-highlight" : "bg-success"}`} />
          {barStatus}
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {editingSet && shownItems.length < MAX_SET_IMAGES && (image || video ? (
          <button onClick={() => { slotRef.current = null; versionInput.current?.click(); }} disabled={adding} className={quiet}>
            {adding ? uploadLabel : video ? "Add a video" : "Add images"}
          </button>
        ) : (
          // Another page in this version, like a second email (Derek, 2026-09-16).
          <ActionMenu label={adding ? "Adding…" : "Add page ▾"} title="Add another page to this version" items={[
            { label: "Paste code", onClick: () => openPaste(null) },
            { label: "Upload .html files", disabled: adding, onClick: () => { slotRef.current = null; setPasteOpen(false); setPasteSlot(null); versionInput.current?.click(); } },
          ]} />
        ))}
        <button onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen} className={quiet}>
          {historyOpen ? "Hide history" : `History${timeline.length ? ` · ${timeline.length}` : ""}`}
        </button>
        {moreActions}
        {needsSend && (
          <button onClick={send} disabled={busy !== null}
            className="rounded-lg bg-accent px-5 py-1.5 text-[16px] font-semibold text-white disabled:opacity-50">
            {busy === "send" ? "Sending…" : doc.version === 0 ? "Send for review" : "Send changes"}
          </button>
        )}
      </div>
    </div>
  ) : null;

  // Full screen puts Files and History in a right column beside the writing
  // (Derek, 2026-09-11); in place they stack under it, since the task column is narrow.
  const content = (
    <>
    {reviewBar}
    {versioned && historyPanel && <div className="-mt-3 mb-6">{historyPanel}</div>}
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

      {!reviewBar && (
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
      )}

      {!versioned && historyPanel}

      </div>
      {/* Files and Comments stay beside the writing as it scrolls (Derek, 2026-09-11). */}
      {/* Stays beside the writing as it scrolls, except on a version with several
          images, where each image's comments line up beside that image instead. */}
      <div className={`space-y-3 ${shownItems.length > 1 ? "" : "lg:sticky lg:top-0 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto"}`}>
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
        <CommentThread comments={versioned ? commentsFor(comments, shownIds) : comments} onPost={postComment} when={timeAgo} viewer="team"
          pinLabel={versioned ? imagePlace : undefined} pinGroups={image || shownItems.length > 1 ? shownItems.map((_, i) => itemLabel(shownItems, i)) : undefined}
          alignGroup={versioned ? (label) => {
            const i = shownItems.findIndex((_, n) => itemLabel(shownItems, n) === label);
            return i < 0 ? null : document.querySelector<HTMLElement>(`[data-image-anchor="${shownItems[i].file}"], [data-page-anchor="${shownItems[i].file}"]`);
          } : undefined} pinDraftLabel={versioned && pinDraft ? imagePlace(pinDraft.fileId) : null}
          pinTone={image ? "var(--highlight)" : undefined} hoverId={image ? hoveredComment : undefined} onHover={image ? setHoveredComment : undefined}
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
    </>
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
