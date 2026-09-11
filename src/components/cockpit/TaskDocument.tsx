"use client";

// The client document on a task: the team writes it, sends the client a private
// link (no login), and sees what the client changed or approved. See
// supabase/task-documents.sql and src/lib/taskDocumentServer.ts.
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
  type TaskDocument as Doc, type TaskDocumentStatus, type TaskDocumentVersion,
  type TaskDocumentFile, type TaskDocumentCheckpoint, type TaskDocumentComment,
} from "@/lib/db";
import { diffDocText, summarizeDocChanges } from "@/lib/docDiff";
import { addDocFiles } from "@/lib/docFileUpload";
import { formatFileSize, isPreviewableImage } from "@/lib/uploadTypes";
import { RichTextEditor } from "./RichTextEditor";
import { useDebouncedCommit } from "./useDebouncedCommit";
import {
  CommentThread, FileDropLine, ImageLightbox, ImageThumbGrid, WorkItemBadge, WorkItemRow, WorkItemWindow,
  quietButton as quiet, type PreviewImage,
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
const KIND_LABEL: Record<TaskDocumentVersion["kind"], string> = {
  sent: "Sent to client",
  client_submitted: "Client sent changes",
  client_approved: "Client approved",
};
const HISTORY_PREVIEW = 5;

const docApi = (taskId: string, path: string, init?: RequestInit) =>
  authedFetch(`/api/tasks/${encodeURIComponent(taskId)}/document${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

export function TaskDocument({ task, onPatch, pushToast, startNonce, onPresence, meId, onEmailClient }: {
  task: Task;
  onPatch: (patch: Partial<Task>) => void;
  pushToast: (text: string) => void;
  canAdmin: boolean;
  /** The viewer's member id, the id a teammate's comment is saved under, so their own comments can be edited. */
  meId?: string | null;
  /** Opens an email to the client with the review link, written with AI: after a
   *  send, or from the Email client button. `changes` sums up what changed since
   *  the version before. Returns true when it opened one (there is a contact to
   *  email), so this window steps aside. */
  onEmailClient?: (review: { url: string | null; name: string; text: string; changes: string | null }) => boolean;
  /** Bumped by the "+ Client document" chip: start the document if there is none, then show it. */
  startNonce: number;
  /** Tells the drawer whether a document exists, so it can hide the chip. */
  onPresence: (exists: boolean) => void;
}) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [link, setLink] = useState<{ live: boolean; copyable: boolean } | null>(null);
  const [files, setFiles] = useState<TaskDocumentFile[]>([]);
  const [versions, setVersions] = useState<TaskDocumentVersion[]>([]);
  const [checkpoints, setCheckpoints] = useState<TaskDocumentCheckpoint[]>([]);
  // The thread shared with the client (Derek, 2026-09-11: "a chat box for comments").
  const [comments, setComments] = useState<TaskDocumentComment[]>([]);
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
    const fresh = await fetchTaskDocument(task.id);
    const previous = versionRef.current;
    versionRef.current = fresh?.version ?? null;
    setDoc(fresh);
    setLoaded(true);
    void fetchDeletedTaskDocuments(task.id).then(setDeletedDocs);
    if (!fresh) return;
    void fetchTaskDocumentFiles(fresh.id).then(setFiles);
    // A client's comment logs an event on the task too, so it arrives here the same way.
    void fetchTaskDocumentComments(fresh.id).then(setComments);
    if (previous !== null && fresh.version > previous) {
      const latest = (await fetchTaskDocumentVersions(fresh.id))[0];
      if (latest && latest.kind !== "sent") {
        // The client published. Show their text, unless the team is mid edit:
        // then keep the team's working copy and offer theirs.
        if (fresh.draftDirty) setClientCrossed(latest);
        else { latestHtml.current = null; setSeed(null); setNonce((n) => n + 1); }
      }
    }
    const res = await docApi(task.id, "/link");
    if (res.ok) setLink(await res.json());
  }, [task.id]);

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

  // Thumbnails load only while the document is open, an hour's link each.
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
    const res = await docApi(task.id, "", { method: "POST", body: "{}" });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not start the document."); return null; }
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
    const p = docApi(task.id, "", { method: "PATCH", body: payload, keepalive: payload.length < 60_000 })
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
    const res = await docApi(task.id, "", { method: "PATCH", body: JSON.stringify({ body: latestHtml.current ?? doc.body, checkpoint: true }) });
    const j = await readJson(res);
    if (!res.ok) { setSaveState("unsaved"); pushToast((j.error as string) ?? "Could not save the document."); return; }
    setDoc(rowToTaskDocument(j.document));
    setSaveState("saved");
    pushToast("Draft saved.");
  };

  const saveTitle = async (value: string) => {
    if (!doc || value.trim() === doc.title.trim()) return;
    const res = await docApi(task.id, "", { method: "PATCH", body: JSON.stringify({ title: value }), keepalive: true });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not rename the document."); return; }
    setDoc(rowToTaskDocument(j.document));
  };

  const send = async () => {
    if (!doc) return;
    commit.flush();
    await saving.current;
    setBusy("send");
    const res = await docApi(task.id, "/send", { method: "POST", body: JSON.stringify({ baseVersion: doc.version }) });
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
      url, name: doc.title.trim() || task.title, text: htmlToText(sentBody).slice(0, 3000),
      changes: previousBody ? summarizeDocChanges(previousBody, sentBody) : null,
    }) ?? false;
    if (emailing) switchView({ full: false });
    if (copied) pushToast(emailing ? "Sent for review. Link copied and added to the email." : "Sent for review. Link copied, paste it to your client.");
    else if (url) pushToast(`Sent for review. Share this link: ${url}`);
    else pushToast("Sent for review.");
  };

  // The one link control (Derek, 2026-09-11: "just need a copy link button that's
  // all keep it simple"). Sending makes the link; deleting the document ends it.
  const fetchLink = async (): Promise<string | null> => {
    const res = await docApi(task.id, "/link", { method: "POST", body: JSON.stringify({ action: "copy" }) });
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
      url, name: doc.title.trim() || task.title,
      text: htmlToText(latest?.body ?? doc.body).slice(0, 3000),
      changes: latest && before ? summarizeDocChanges(before.body, latest.body) : null,
    });
    if (opened) switchView({ full: false });
    else pushToast("Link a contact to this client to email them from here.");
  };

  const patchDoc = async (payload: Record<string, unknown>, done: string) => {
    commit.flush();
    await saving.current;
    const res = await docApi(task.id, "", { method: "PATCH", body: JSON.stringify(payload) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not update the document."); return; }
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
    const res = await docApi(task.id, "", { method: "PATCH", body: JSON.stringify({ status }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not change the stage."); return; }
    setDoc(rowToTaskDocument(j.document));
  };

  const deleteDocument = async () => {
    if (!doc || !window.confirm("Delete this document? You can restore it from this task for 30 days, with its versions, files and comments. The client's link stops working until then.")) return;
    commit.flush();
    titleCommit.flush();
    await saving.current;
    setBusy("delete");
    const res = await docApi(task.id, "", { method: "DELETE" });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not delete the document."); return; }
    setFull(false);
    versionRef.current = null;
    setDoc(null);
    setFiles([]);
    setComments([]);
    setLink(null);
    void fetchDeletedTaskDocuments(task.id).then(setDeletedDocs);
    pushToast("Document deleted. Restore it from this task within 30 days.");
  };

  const restoreDocument = async (documentId: string) => {
    setBusy("restore");
    const res = await docApi(task.id, "/restore", { method: "POST", body: JSON.stringify({ documentId }) });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not restore the document."); return; }
    versionRef.current = null;
    await load();
    pushToast("Document restored.");
  };

  const postComment = async (body: string) => {
    const res = await docApi(task.id, "/comments", { method: "POST", body: JSON.stringify({ body }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not post the comment."); return false; }
    setComments((c) => [...c, { ...(j.comment as TaskDocumentComment), authorId: meId ?? null }]);
    return true;
  };

  // Edit your own comment, tick any comment done, delete any comment.
  const changeComment = async (commentId: string, change: { body?: string; done?: boolean }) => {
    const res = await docApi(task.id, "/comments", { method: "PATCH", body: JSON.stringify({ commentId, ...change }) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not update the comment."); return false; }
    const next = j.comment as TaskDocumentComment;
    setComments((cs) => cs.map((c) => (c.id === commentId ? { ...next, authorId: c.authorId } : c)));
    return true;
  };
  const removeComment = async (commentId: string) => {
    if (!window.confirm("Delete this comment? The client stops seeing it too.")) return false;
    const res = await docApi(task.id, "/comments", { method: "DELETE", body: JSON.stringify({ commentId }) });
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
      (payload) => docApi(task.id, "/files", { method: "POST", body: JSON.stringify(payload) }),
      () => { void fetchTaskDocumentFiles(doc.id).then(setFiles); },
    );
    setAdding(false);
    if (error) pushToast(error);
    await load();
  };

  const removeFile = async (f: TaskDocumentFile) => {
    if (!doc || !window.confirm(`Remove ${f.name}? The client stops seeing it too.`)) return;
    const res = await docApi(task.id, "/files", { method: "DELETE", body: JSON.stringify({ fileId: f.id }) });
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
      <span>Deleted:</span>
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
    <select value={doc.status} onChange={(e) => void setStage(e.target.value as TaskDocumentStatus)} aria-label="Document stage"
      className="cursor-pointer rounded-full border-0 px-3 py-1 text-[16px] font-semibold outline-none" style={{ background: tone.chip, color: tone.dot }}>
      {STAGES.map((s) => <option key={s} value={s}>{STATUS_VIEW[s].label}</option>)}
    </select>
  );
  const needsSend = !locked && (doc.version === 0 || doc.draftDirty);
  const name = doc.title.trim() || task.title;
  const activeFiles = files.filter((f) => !f.removedAt);
  const previewImages: PreviewImage[] = activeFiles
    .filter((f) => isPreviewableImage(f.name) && thumbs[f.path])
    .map((f) => ({ id: f.id, name: f.name, url: thumbs[f.path] }));
  const openFileOrPreview = (f: TaskDocumentFile) => {
    const i = previewImages.findIndex((p) => p.id === f.id);
    if (i >= 0) setLightbox(i);
    else void openFile(f);
  };
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
    doc.version ? `Version ${doc.version}` : "Not sent yet",
    doc.version > 0 && link ? `Link ${link.live ? "on" : "off"}` : null,
    activeFiles.length ? `${activeFiles.length} ${activeFiles.length === 1 ? "file" : "files"}` : null,
    `Edited ${timeAgo(doc.updatedAt)}`,
  ].filter(Boolean).join(" · ");

  const row = (
    <WorkItemRow icon="📄" title={name} badge={badge} meta={meta} actions={copyLinkButton}
      onOpen={() => switchView({ full: true })} />
  );
  if (!visible) return <>{row}{deletedLine}</>;

  const saveLabel = saveState === "unsaved" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : `Edited ${timeAgo(doc.updatedAt)}`;

  // One history, newest first: sends and client versions, the team's saved
  // drafts, and files coming and going, each with who and when. "What changed"
  // compares a text entry with the text entry before it, whichever kind it was.
  type Entry = { key: string; at: string; title: string; who: string | null; body?: string; restore?: Record<string, unknown>; restored?: string };
  const timeline: Entry[] = [
    ...versions.map((v): Entry => ({ key: v.id, at: v.createdAt, title: `Version ${v.version}: ${KIND_LABEL[v.kind]}`, who: v.authorLabel, body: v.body, restore: { restoreVersion: v.version }, restored: `Version ${v.version} is back.` })),
    ...checkpoints.map((c): Entry => ({ key: c.id, at: c.createdAt, title: "Saved draft", who: c.authorLabel, body: c.body, restore: { restoreCheckpoint: c.id }, restored: "That draft is back." })),
    ...files.map((f): Entry => ({ key: `${f.id}:added`, at: f.createdAt, title: `Added ${f.name}`, who: f.addedByLabel })),
    ...files.filter((f) => f.removedAt).map((f): Entry => ({ key: `${f.id}:removed`, at: f.removedAt!, title: `Removed ${f.name}`, who: f.removedByLabel })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const shownTimeline = allHistory ? timeline : timeline.slice(0, HISTORY_PREVIEW);

  const titleInput = (
    <input value={titleDraft}
      onChange={(e) => { const value = e.target.value; setTitleDraft(value); titleCommit.schedule(() => { void saveTitle(value); }); }}
      onBlur={() => titleCommit.flush()}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      placeholder={task.title} aria-label="Document name" maxLength={200}
      className="w-full rounded-md bg-transparent px-1 py-0.5 text-[22px] font-bold outline-none placeholder:text-foreground hover:bg-background focus:bg-background" />
  );

  // Full screen puts Files and History in a right column beside the writing
  // (Derek, 2026-09-11); in place they stack under it, since the task column is narrow.
  const content = (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
      {clientCrossed && (
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
              ? "This document is completed. Reopen it to make changes."
              : <>The client approved {doc.approvedVersion ? `version ${doc.approvedVersion}` : "this document"}. Reopen it to make changes.</>}
          </span>
          <button onClick={() => void patchDoc({ reopen: true }, "Reopened. Send your changes when they're ready.")} className={quiet}>Reopen for changes</button>
        </div>
      )}

      <article className="rounded-2xl border bg-surface p-5 shadow-sm sm:p-8">
        <RichTextEditor key={`doc-${doc.id}-${nonce}`} value={seed ?? doc.body} editable={!locked} variant="doc"
          placeholder="Write the content for your client…"
          onChange={(html) => { latestHtml.current = html; setSaveState("unsaved"); commit.schedule(() => { void save(html); }); }} />
      </article>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!locked && needsSend && (
          <button onClick={send} disabled={busy !== null}
            className="rounded-lg bg-accent px-6 py-2.5 text-[16px] font-semibold text-white disabled:opacity-50">
            {busy === "send" ? "Sending…" : doc.version === 0 ? "Send for review" : "Send changes"}
          </button>
        )}
        {!locked && <button onClick={() => void saveDraft()} disabled={busy !== null || saveState === "saving"} className={quiet}>Save draft</button>}
        {/* When it last saved sits beside Save draft (Derek, 2026-09-11). */}
        {!locked && <span className="text-[16px] text-muted">{saveLabel}{needsSend ? "" : " · Everything here has been sent"}</span>}
        <button onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen} className={`ml-auto ${quiet}`}>
          {historyOpen ? "Hide history" : `History${timeline.length ? ` · ${timeline.length}` : ""}`}
        </button>
      </div>

      {historyOpen && (
        <section className="mt-3 rounded-xl border bg-surface px-4 py-2.5">
          {timeline.length === 0 && <p className="text-[16px] text-muted">Saves, sends, client changes and files show up here with who did them.</p>}
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
        <CommentThread comments={comments} onPost={postComment} when={timeAgo} viewer="team"
          isMine={(c) => !!meId && comments.find((x) => x.id === c.id)?.authorId === meId}
          canDelete={() => true}
          onEdit={(id, body) => changeComment(id, { body })}
          onToggleDone={(id, done) => changeComment(id, { done })}
          onDelete={removeComment} />
      </div>
    </div>
  );

  return (
    <>
      {row}
      {deletedLine}
      {full && (
        <WorkItemWindow icon="📄" title={titleInput} badge={stageSelect} actions={headerActions} onClose={() => switchView({ full: false })}>
          {content}
          {/* Deleting lives only here, small and at the very end (Derek, 2026-09-11). */}
          <div className="mt-12 flex justify-end border-t pt-4">
            <button onClick={() => void deleteDocument()} disabled={busy !== null} className="text-[16px] text-muted hover:text-danger hover:underline disabled:opacity-50">
              {busy === "delete" ? "Deleting…" : "Delete document"}
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
