"use client";

// The client document on a task: the team writes it, sends the client a private
// link (no login), and sees what the client changed or approved. See
// supabase/task-documents.sql and src/lib/taskDocumentServer.ts.
//
// Reads go through the browser client and row level security (db.ts); every
// write goes through /api/tasks/[id]/document so the HTML is cleaned on the
// server and an approved document stays locked. A client's send or approval
// updates the task row, which arrives here live as a change to the task's
// status and comments, and that is what makes this block refetch.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATUS_META, timeAgo, type Task, type TaskStatus } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";
import {
  fetchTaskDocument, fetchTaskDocumentVersions, fetchTaskDocumentFiles, fetchTaskDocumentCheckpoints,
  rowToTaskDocument, signedUrlForFile,
  type TaskDocument as Doc, type TaskDocumentStatus, type TaskDocumentVersion,
  type TaskDocumentFile, type TaskDocumentCheckpoint,
} from "@/lib/db";
import { diffDocText } from "@/lib/docDiff";
import { addDocFiles } from "@/lib/docFileUpload";
import { formatFileSize } from "@/lib/uploadTypes";
import { RichTextEditor } from "./RichTextEditor";
import { useDebouncedCommit } from "./useDebouncedCommit";

const STATUS_VIEW: Record<TaskDocumentStatus, { label: string; tone: TaskStatus }> = {
  draft: { label: "Draft", tone: "todo" },
  with_client: { label: "With client", tone: "waiting" },
  client_submitted: { label: "Client sent changes", tone: "review" },
  approved: { label: "Approved", tone: "approved" },
};
const KIND_LABEL: Record<TaskDocumentVersion["kind"], string> = {
  sent: "Sent to client",
  client_submitted: "Client sent changes",
  client_approved: "Client approved",
};

const docApi = (taskId: string, path: string, init?: RequestInit) =>
  authedFetch(`/api/tasks/${encodeURIComponent(taskId)}/document${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

export function TaskDocument({ task, onPatch, pushToast, canAdmin, open, onPresence }: {
  task: Task;
  onPatch: (patch: Partial<Task>) => void;
  pushToast: (text: string) => void;
  canAdmin: boolean;
  /** The "+ Client document" chip was clicked: show the start card even with no document yet. */
  open: boolean;
  /** Tells the drawer whether a document exists, so it can hide the chip. */
  onPresence: (exists: boolean) => void;
}) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [link, setLink] = useState<{ live: boolean; copyable: boolean } | null>(null);
  const [versions, setVersions] = useState<TaskDocumentVersion[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  // Files under the document, and the team's saved drafts for the history.
  const [files, setFiles] = useState<TaskDocumentFile[]>([]);
  const [checkpoints, setCheckpoints] = useState<TaskDocumentCheckpoint[]>([]);
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // What the editor holds right now, for a Save draft click.
  const latestHtml = useRef<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // The client sent changes while this teammate still had unsent edits.
  const [clientCrossed, setClientCrossed] = useState<TaskDocumentVersion | null>(null);
  // Typing saves on its own; this is what says so (Derek, 2026-09-11: "add a save draft").
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved">("idle");
  // The draft over the whole window, for real writing (Derek, 2026-09-11).
  const [full, setFull] = useState(false);
  // Folded down to its header line (Derek, 2026-09-11: "can we toggle it closed?").
  // Remembered per task on this device.
  const collapseKey = `doc-collapsed:${task.id}`;
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem(collapseKey) === "1"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { if (next) window.localStorage.setItem(collapseKey, "1"); else window.localStorage.removeItem(collapseKey); } catch { /* not kept */ }
  };
  const commit = useDebouncedCommit();
  const saving = useRef<Promise<boolean> | null>(null);

  // Moving in or out of the window remounts the editor, which starts from the
  // saved body, so the pending save lands first.
  const setFullWindow = async (next: boolean) => {
    commit.flush();
    await saving.current;
    setFull(next);
  };
  useEffect(() => {
    if (!full) return;
    // Capture phase, so Esc closes the window and not the whole task drawer.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); void setFullWindow(false); } };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; };
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  const versionRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    const fresh = await fetchTaskDocument(task.id);
    const previous = versionRef.current;
    versionRef.current = fresh?.version ?? null;
    setDoc(fresh);
    setLoaded(true);
    if (!fresh) return;
    // A client adding or removing a file logs an event on the task, which is
    // what brings us here, so the list is read on every load.
    void fetchTaskDocumentFiles(fresh.id).then(setFiles);
    if (previous !== null && fresh.version > previous) {
      const latest = (await fetchTaskDocumentVersions(fresh.id))[0];
      if (latest && latest.kind !== "sent") {
        // The client published. Show their text, unless the team is mid edit:
        // then keep the team's working copy and offer theirs.
        if (fresh.draftDirty) setClientCrossed(latest);
        else { latestHtml.current = null; setNonce((n) => n + 1); }
      }
    }
    const res = await docApi(task.id, "/link");
    if (res.ok) setLink(await res.json());
  }, [task.id]);

  // Fetch when the task opens. State is set only after the request resolves; the
  // rule flags any fetch on mount, and this app marks each one the same way.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  // A client's send or approval lands on the task row live (status and an event
  // comment), so either changing is the cue to look again.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (loaded) void load(); }, [task.status, task.comments.length]);

  const exists = !!doc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onPresence(exists); }, [exists]);

  useEffect(() => {
    if (!historyOpen || !doc) return;
    let cancelled = false;
    void Promise.all([fetchTaskDocumentVersions(doc.id), fetchTaskDocumentCheckpoints(doc.id)]).then(([v, c]) => {
      if (!cancelled) { setVersions(v); setCheckpoints(c); }
    });
    return () => { cancelled = true; };
  }, [historyOpen, doc?.id, doc?.version, doc?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const readJson = async (res: Response) => res.json().catch(() => ({} as Record<string, unknown>));
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); return true; } catch { return false; } };

  const save = (html: string) => {
    setSaveState("saving");
    const p = docApi(task.id, "", { method: "PATCH", body: JSON.stringify({ body: html }) }).then(async (res) => {
      const j = await readJson(res);
      if (res.ok) { setDoc(rowToTaskDocument(j.document)); setSaveState("saved"); }
      else { setSaveState("unsaved"); pushToast((j.error as string) ?? "Could not save the document."); }
      return res.ok;
    });
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

  const addFiles = async (list: FileList | null) => {
    if (!doc || !list?.length || adding) return;
    setAdding(true);
    const error = await addDocFiles(
      Array.from(list),
      (payload) => docApi(task.id, "/files", { method: "POST", body: JSON.stringify(payload) }),
      () => { void fetchTaskDocumentFiles(doc.id).then(setFiles); },
    );
    setAdding(false);
    if (error) pushToast(error);
    // A new file is something to send, so the document reloads to show Send changes.
    await load();
  };

  const removeFile = async (f: TaskDocumentFile) => {
    if (!doc || !window.confirm(f.sharedAt ? `Remove ${f.name}? The client stops seeing it too.` : `Remove ${f.name}?`)) return;
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

  const create = async () => {
    setBusy("create");
    const res = await docApi(task.id, "", { method: "POST", body: "{}" });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not start the document."); return; }
    const created = rowToTaskDocument(j.document);
    versionRef.current = created.version;
    setDoc(created);
    setLoaded(true);
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
    await load();
    if (task.status !== "waiting") onPatch({ status: "waiting" });
    const url = j.url as string | null;
    if (url && await copy(url)) pushToast("Sent for review. Link copied, paste it to your client.");
    else if (url) pushToast(`Sent for review. Share this link: ${url}`);
    else pushToast("Sent for review. Make a new link to get one you can share.");
  };

  const linkAction = async (action: "copy" | "new") => {
    setBusy(action);
    const res = await docApi(task.id, "/link", { method: "POST", body: JSON.stringify({ action }) });
    const j = await readJson(res);
    setBusy(null);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not get the link."); return; }
    const url = j.url as string;
    if (action === "new") setLink({ live: true, copyable: true });
    pushToast(await copy(url) ? (action === "new" ? "New link copied." : "Link copied.") : `Share this link: ${url}`);
  };

  const makeNewLink = () => {
    if (link?.live && !window.confirm("Make a new link? The old link stops working.")) return;
    void linkAction("new");
  };

  const turnOff = async () => {
    if (!window.confirm("Turn the link off? The client's link stops working, and turning it back on makes a new link.")) return;
    setBusy("off");
    const res = await docApi(task.id, "/link", { method: "DELETE" });
    setBusy(null);
    if (!res.ok) { pushToast("Could not turn the link off."); return; }
    setLink({ live: false, copyable: false });
    pushToast("Link turned off.");
  };

  const patchDoc = async (payload: Record<string, unknown>, done: string) => {
    commit.flush();
    await saving.current;
    const res = await docApi(task.id, "", { method: "PATCH", body: JSON.stringify(payload) });
    const j = await readJson(res);
    if (!res.ok) { pushToast((j.error as string) ?? "Could not update the document."); return; }
    setDoc(rowToTaskDocument(j.document));
    latestHtml.current = null;
    setNonce((n) => n + 1);
    setClientCrossed(null);
    pushToast(done);
  };

  if (!doc) {
    if (!open) return null;
    return (
      <div className="mt-4 rounded-xl border bg-surface p-5 sm:p-6">
        <div className="mb-1.5 text-[16px] font-semibold uppercase tracking-wide text-muted">Client document</div>
        {!loaded ? (
          <p className="text-[16px] text-muted">Loading…</p>
        ) : (
          <>
            <p className="text-[16px] leading-relaxed">Write content for the client to review. They get a private link, no login needed, and can edit it or approve it.</p>
            <button onClick={create} disabled={busy === "create"}
              className="mt-2.5 rounded-lg bg-accent px-5 py-2.5 text-[16px] font-medium text-white disabled:opacity-50">
              {busy === "create" ? "Starting…" : "Start the document"}
            </button>
          </>
        )}
      </div>
    );
  }

  const view = STATUS_VIEW[doc.status];
  const tone = STATUS_META[view.tone];
  const locked = !!doc.approvedAt;
  const needsSend = !locked && (doc.version === 0 || doc.draftDirty);
  const quiet = "rounded-lg border px-2.5 py-1 text-[16px] font-medium text-muted transition hover:bg-background hover:text-foreground disabled:opacity-50";
  const activeFiles = files.filter((f) => !f.removedAt);

  // One history, newest first: sends and client versions, the team's saved
  // drafts, and files coming and going, each with who and when. "What changed"
  // compares a text entry with the text entry before it, whichever kind it was.
  type Entry = { key: string; at: string; title: string; who: string | null; body?: string; restore?: Record<string, unknown>; restored?: string };
  const timeline: Entry[] = !historyOpen ? [] : [
    ...versions.map((v): Entry => ({ key: v.id, at: v.createdAt, title: `Version ${v.version}: ${KIND_LABEL[v.kind]}`, who: v.authorLabel, body: v.body, restore: { restoreVersion: v.version }, restored: `Version ${v.version} is back.` })),
    ...checkpoints.map((c): Entry => ({ key: c.id, at: c.createdAt, title: "Saved draft", who: c.authorLabel, body: c.body, restore: { restoreCheckpoint: c.id }, restored: "That draft is back." })),
    ...files.map((f): Entry => ({ key: `${f.id}:added`, at: f.createdAt, title: `Added ${f.name}`, who: f.addedByLabel })),
    ...files.filter((f) => f.removedAt).map((f): Entry => ({ key: `${f.id}:removed`, at: f.removedAt!, title: `Removed ${f.name}`, who: f.removedByLabel })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const block = (
    <div className={full
      ? "mx-auto w-full max-w-[920px] rounded-2xl border bg-surface p-6 shadow-xl sm:p-10"
      : "mt-4 rounded-xl border bg-surface p-5 sm:p-6"}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[16px] font-semibold uppercase tracking-wide text-muted">Client document</span>
        <span className="rounded-full px-2 py-0.5 text-[16px] font-semibold" style={{ background: tone.chip, color: tone.dot }}>{view.label}</span>
        {doc.version > 0 && <span className="text-[16px] text-muted">Version {doc.version}</span>}
        {doc.version > 0 && link && <span className="text-[16px] text-muted">· Link {link.live ? "on" : "off"}</span>}
        <span className="ml-auto flex gap-2">
          {!full && <button onClick={toggleCollapsed} aria-expanded={!collapsed} className={quiet}>{collapsed ? "Show" : "Hide"}</button>}
          {!(collapsed && !full) && (
            <button onClick={() => void setFullWindow(!full)} className={quiet}>
              {full ? "Close full window" : "Full window"}
            </button>
          )}
        </span>
      </div>

      {!(collapsed && !full) && (<>
      {clientCrossed && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft/40 px-3 py-2 text-[16px]">
          <span className="min-w-0 flex-1">{clientCrossed.authorLabel ?? "The client"} sent changes while you had unsent edits.</span>
          <button onClick={() => void patchDoc({ restoreVersion: clientCrossed.version }, "Their version is in. Send it when it's ready.")} className="font-medium text-accent hover:underline">Use their version</button>
          <button onClick={() => setClientCrossed(null)} className="font-medium text-muted hover:underline">Keep mine</button>
        </div>
      )}
      {locked && (
        <div className="mb-2 rounded-lg px-3 py-2 text-[16px]" style={{ background: STATUS_META.approved.chip, color: STATUS_META.approved.dot }}>
          The client approved {doc.approvedVersion ? `version ${doc.approvedVersion}` : "this document"}. Reopen it to make changes.
        </div>
      )}

      <RichTextEditor key={`doc-${doc.id}-${nonce}`} value={doc.body} editable={!locked} variant="doc" tall={full}
        placeholder="Write the content for your client…"
        onChange={(html) => { latestHtml.current = html; setSaveState("unsaved"); commit.schedule(() => { void save(html); }); }} />

      {/* Files. Drops here stop at this box: the drawer would otherwise take
          them as task attachments, and React events cross the full window's portal. */}
      <div
        onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) e.stopPropagation(); }}
        onDragOver={(e) => { if (!locked && e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); setDropping(true); } }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); setDropping(false); if (!locked) void addFiles(e.dataTransfer.files); }}
        className={`mt-4 rounded-lg border-2 p-3 ${dropping ? "border-dashed border-accent bg-accent-soft/30" : "border-transparent bg-background/50"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[16px] font-semibold uppercase tracking-wide text-muted">Files</span>
          {!locked && (
            <>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
              <button onClick={() => fileInput.current?.click()} disabled={adding} className={`ml-auto ${quiet}`}>{adding ? "Adding…" : "Add files"}</button>
            </>
          )}
        </div>
        {activeFiles.length === 0 ? (
          <p className="mt-1 text-[16px] text-muted">No files yet. Photos, PDFs, documents, spreadsheets, slides or videos up to 25 MB, dropped here or added with the button.</p>
        ) : (
          <ul className="mt-2 divide-y">
            {activeFiles.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[16px]">
                <button onClick={() => void openFile(f)} className="min-w-0 break-words text-left font-medium text-accent hover:underline">{f.name}</button>
                <span className="text-muted">{formatFileSize(f.sizeBytes)} · {f.addedByLabel ?? "Someone"} · {timeAgo(f.createdAt)}</span>
                {!f.sharedAt && <span className="rounded-full bg-background px-2 py-0.5 text-muted">Not sent yet</span>}
                {!locked && <button onClick={() => void removeFile(f)} className="ml-auto text-muted hover:text-danger hover:underline">Remove</button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {needsSend && (
          <button onClick={send} disabled={busy !== null}
            className="rounded-lg bg-accent px-5 py-2.5 text-[16px] font-medium text-white disabled:opacity-50">
            {busy === "send" ? "Sending…" : doc.version === 0 ? "Send for review" : "Send changes"}
          </button>
        )}
        {!locked && <button onClick={() => void saveDraft()} disabled={busy !== null || saveState === "saving"} className={quiet}>Save draft</button>}
        {!locked && saveState !== "idle" && (
          <span className="text-[16px] text-muted">{saveState === "unsaved" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : "Draft saved"}</span>
        )}
        {link?.live && link.copyable && <button onClick={() => void linkAction("copy")} disabled={busy !== null} className={quiet}>Copy link</button>}
        {doc.version > 0 && canAdmin && <button onClick={makeNewLink} disabled={busy !== null} className={quiet}>{link?.live ? "Make a new link" : "Turn link on"}</button>}
        {link?.live && <button onClick={() => void turnOff()} disabled={busy !== null} className={quiet}>Turn link off</button>}
        {locked && <button onClick={() => void patchDoc({ reopen: true }, "Reopened. Send your changes when they're ready.")} className={quiet}>Reopen for changes</button>}
        <button onClick={() => setHistoryOpen((o) => !o)} className={quiet}>{historyOpen ? "Hide history" : "History"}</button>
      </div>

      {historyOpen && (
        <div className="mt-3 space-y-1.5 border-t pt-3">
          {timeline.length === 0 && <p className="text-[16px] text-muted">Nothing yet. Saves, sends, client changes and files show up here with who did them.</p>}
          {timeline.map((entry, i) => {
            const previous = entry.body === undefined ? undefined : timeline.slice(i + 1).find((e) => e.body !== undefined);
            const showing = openEntry === entry.key;
            const d = showing && previous?.body !== undefined && entry.body !== undefined ? diffDocText(previous.body, entry.body) : null;
            const changed = !!d && d.parts.some((p) => p.type !== "same");
            return (
              <div key={entry.key} className="rounded-lg border px-2.5 py-2">
                <button onClick={() => entry.body !== undefined && setOpenEntry(showing ? null : entry.key)}
                  className={`flex w-full flex-wrap items-center gap-x-2 text-left text-[16px] ${entry.body === undefined ? "cursor-default" : ""}`}>
                  <span className="font-semibold">{entry.title}</span>
                  {entry.who && <span className="text-muted">by {entry.who}</span>}
                  <span className="text-muted">{timeAgo(entry.at)}</span>
                </button>
                {showing && (
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
                        className="mt-2 text-[16px] font-medium text-accent hover:underline">Use this version</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </>)}
    </div>
  );

  if (!full) return block;
  // Portalled to the body so it sits above the drawer and the app chrome.
  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-background px-4 py-6 sm:py-10">{block}</div>,
    document.body,
  );
}
