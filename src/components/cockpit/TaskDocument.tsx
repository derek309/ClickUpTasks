"use client";

// The client document on a task: the team writes it, sends the client a private
// link (no login), and sees what the client changed or approved. See
// supabase/task-documents.sql and src/lib/taskDocumentServer.ts.
//
// In the task it is one line, closed until Show opens it in place or Open full
// opens it over the whole screen (TaskWorkItem). Reads go through the browser
// client and row level security (db.ts); every write goes through
// /api/tasks/[id]/document so the HTML is cleaned on the server and an approved
// document stays locked. A client's send, approval or file lands on the task row
// live (status and an event comment), and that is what makes this refetch.
import { useCallback, useEffect, useRef, useState } from "react";
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
import { FileDropLine, WorkItemBadge, WorkItemInline, WorkItemRow, WorkItemWindow, quietButton as quiet } from "./TaskWorkItem";

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
const HISTORY_PREVIEW = 5;

const docApi = (taskId: string, path: string, init?: RequestInit) =>
  authedFetch(`/api/tasks/${encodeURIComponent(taskId)}/document${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

export function TaskDocument({ task, onPatch, pushToast, canAdmin, startNonce, onPresence }: {
  task: Task;
  onPatch: (patch: Partial<Task>) => void;
  pushToast: (text: string) => void;
  canAdmin: boolean;
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
  const [shown, setShown] = useState(false);
  const [full, setFull] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [allHistory, setAllHistory] = useState(false);
  const [linkMenu, setLinkMenu] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Moving between in place and full screen remounts the editor; it starts from
  // what was last typed, which may not be saved back from the server yet.
  const [seed, setSeed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // The client sent changes while this teammate still had unsent edits.
  const [clientCrossed, setClientCrossed] = useState<TaskDocumentVersion | null>(null);
  // Typing saves on its own; this is what says so (Derek, 2026-09-11: "add a save draft").
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved">("idle");
  const commit = useDebouncedCommit();
  const saving = useRef<Promise<boolean> | null>(null);
  const versionRef = useRef<number | null>(null);
  // What the editor holds right now, for Save draft and for switching views.
  const latestHtml = useRef<string | null>(null);

  const load = useCallback(async () => {
    const fresh = await fetchTaskDocument(task.id);
    const previous = versionRef.current;
    versionRef.current = fresh?.version ?? null;
    setDoc(fresh);
    setLoaded(true);
    if (!fresh) return;
    void fetchTaskDocumentFiles(fresh.id).then(setFiles);
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

  const visible = shown || full;
  useEffect(() => {
    if (!visible || !doc) return;
    let cancelled = false;
    void Promise.all([fetchTaskDocumentVersions(doc.id), fetchTaskDocumentCheckpoints(doc.id)]).then(([v, c]) => {
      if (!cancelled) { setVersions(v); setCheckpoints(c); }
    });
    return () => { cancelled = true; };
  }, [visible, doc?.id, doc?.version, doc?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const readJson = async (res: Response) => res.json().catch(() => ({} as Record<string, unknown>));
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); return true; } catch { return false; } };

  // Each switch lands the pending save and carries what was typed across.
  const switchView = (next: { shown?: boolean; full?: boolean }, d: Doc | null = doc) => {
    commit.flush();
    setSeed(latestHtml.current);
    if (d && !visible) setTitleDraft(d.title);
    setLinkMenu(false);
    if (next.shown !== undefined) setShown(next.shown);
    if (next.full !== undefined) setFull(next.full);
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
      if (d) switchView({ shown: true }, d);
    })();
  }, [startNonce]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const saveTitle = async () => {
    if (!doc || titleDraft.trim() === doc.title.trim()) return;
    const res = await docApi(task.id, "", { method: "PATCH", body: JSON.stringify({ title: titleDraft }) });
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
    await load();
    if (task.status !== "waiting") onPatch({ status: "waiting" });
    const url = j.url as string | null;
    if (url && await copy(url)) pushToast("Sent for review. Link copied, paste it to your client.");
    else if (url) pushToast(`Sent for review. Share this link: ${url}`);
    else pushToast("Sent for review. Make a new link to get one you can share.");
  };

  const linkAction = async (action: "copy" | "new") => {
    setLinkMenu(false);
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
    setLinkMenu(false);
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
    setSeed(null);
    setNonce((n) => n + 1);
    setClientCrossed(null);
    pushToast(done);
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

  if (!doc) return null;

  const view = STATUS_VIEW[doc.status];
  const tone = STATUS_META[view.tone];
  const badge = <WorkItemBadge label={view.label} chip={tone.chip} dot={tone.dot} />;
  const locked = !!doc.approvedAt;
  const needsSend = !locked && (doc.version === 0 || doc.draftDirty);
  const name = doc.title.trim() || task.title;
  const activeFiles = files.filter((f) => !f.removedAt);
  const copyLinkButton = link?.live && link.copyable
    ? <button onClick={() => void linkAction("copy")} disabled={busy !== null} className={quiet}>Copy link</button>
    : null;

  const meta = [
    doc.version ? `Version ${doc.version}` : "Not sent yet",
    doc.version > 0 && link ? `Link ${link.live ? "on" : "off"}` : null,
    activeFiles.length ? `${activeFiles.length} ${activeFiles.length === 1 ? "file" : "files"}` : null,
    `Edited ${timeAgo(doc.updatedAt)}`,
  ].filter(Boolean).join(" · ");

  const row = (
    <WorkItemRow icon="📄" title={name} badge={badge} meta={meta} actions={copyLinkButton}
      shown={shown} onToggle={() => switchView({ shown: !shown })} onOpenFull={() => switchView({ full: true })} />
  );
  if (!visible) return row;

  const saveLabel = saveState === "unsaved" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : `Edited ${timeAgo(doc.updatedAt)}`;
  const shareText = doc.version === 0
    ? "Not sent yet. Send for review makes a private link for the client, no login needed."
    : link?.live
      ? `Link is on. The client can read, edit and approve version ${doc.version}.`
      : "Link is off. The client can't open this document.";
  const linkMenuItems = [
    doc.version > 0 && canAdmin ? { label: link?.live ? "Make a new link" : "Turn link on", run: makeNewLink } : null,
    link?.live ? { label: "Turn link off", run: () => void turnOff() } : null,
  ].filter((x): x is { label: string; run: () => void } => !!x);

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
    <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onBlur={() => void saveTitle()}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      placeholder={task.title} aria-label="Document name" maxLength={200}
      className="w-full rounded-md bg-transparent px-1 py-0.5 text-[22px] font-bold outline-none placeholder:text-foreground hover:bg-background focus:bg-background" />
  );

  const content = (
    <>
      {clientCrossed && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft/40 px-4 py-3 text-[16px]">
          <span className="min-w-0 flex-1">{clientCrossed.authorLabel ?? "The client"} sent changes while you had unsent edits.</span>
          <button onClick={() => void patchDoc({ restoreVersion: clientCrossed.version }, "Their version is in. Send it when it's ready.")} className="font-semibold text-accent hover:underline">Use their version</button>
          <button onClick={() => setClientCrossed(null)} className="font-medium text-muted hover:underline">Keep mine</button>
        </div>
      )}
      {locked && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-[16px]" style={{ background: STATUS_META.approved.chip, color: STATUS_META.approved.dot }}>
          <span className="min-w-0 flex-1">The client approved {doc.approvedVersion ? `version ${doc.approvedVersion}` : "this document"}. Reopen it to make changes.</span>
          <button onClick={() => void patchDoc({ reopen: true }, "Reopened. Send your changes when they're ready.")} className={quiet}>Reopen for changes</button>
        </div>
      )}

      <div className="relative mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft/40 px-4 py-2.5">
        <span aria-hidden className="text-[18px]">🔗</span>
        <span className="min-w-0 flex-1 text-[16px]">{shareText}</span>
        {copyLinkButton}
        {linkMenuItems.length > 0 && (
          <>
            <button onClick={() => setLinkMenu((m) => !m)} aria-label="Link options" aria-expanded={linkMenu} className={quiet}>•••</button>
            {linkMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setLinkMenu(false)} />
                <div className="absolute right-3 top-full z-20 mt-1 min-w-[220px] overflow-hidden rounded-xl border bg-surface py-1 shadow-xl">
                  {linkMenuItems.map((item) => (
                    <button key={item.label} onClick={item.run} disabled={busy !== null} className="block w-full px-4 py-2.5 text-left text-[16px] hover:bg-background disabled:opacity-50">{item.label}</button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <article className={full ? "rounded-2xl border bg-surface p-5 shadow-sm sm:p-8" : ""}>
        <RichTextEditor key={`doc-${doc.id}-${nonce}-${full ? "full" : "inline"}`} value={seed ?? doc.body} editable={!locked} variant="doc" tall={full}
          placeholder="Write the content for your client…"
          onChange={(html) => { latestHtml.current = html; setSaveState("unsaved"); commit.schedule(() => { void save(html); }); }} />
      </article>

      {!locked && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {needsSend && (
            <button onClick={send} disabled={busy !== null}
              className="rounded-lg bg-accent px-6 py-2.5 text-[16px] font-semibold text-white disabled:opacity-50">
              {busy === "send" ? "Sending…" : doc.version === 0 ? "Send for review" : "Send changes"}
            </button>
          )}
          <button onClick={() => void saveDraft()} disabled={busy !== null || saveState === "saving"} className={quiet}>Save draft</button>
          <span className="text-[16px] text-muted">{needsSend ? saveLabel : "Everything here has been sent."}</span>
        </div>
      )}

      <div className="mt-5 space-y-3">
        <FileDropLine label="Files" count={activeFiles.length} busy={adding} disabled={locked} onFiles={(list) => void addFiles(list)}>
          {activeFiles.length > 0 && (
            <ul className="mt-1.5 divide-y">
              {activeFiles.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[16px]">
                  <button onClick={() => void openFile(f)} className="min-w-0 break-words text-left font-medium text-accent hover:underline">{f.name}</button>
                  <span className="text-muted">{formatFileSize(f.sizeBytes)} · {f.addedByLabel ?? "Someone"}</span>
                  {!f.sharedAt && <span className="rounded-full bg-background px-2 py-0.5 text-muted">Not sent yet</span>}
                  {!locked && <button onClick={() => void removeFile(f)} className="ml-auto text-muted hover:text-danger hover:underline">Remove</button>}
                </li>
              ))}
            </ul>
          )}
        </FileDropLine>

        <section className="rounded-xl border bg-surface px-4 py-2.5">
          <h3 className="text-[16px] font-semibold">History{timeline.length ? ` · ${timeline.length}` : ""}</h3>
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
      </div>
    </>
  );

  return (
    <>
      {row}
      {full ? (
        <WorkItemWindow icon="📄" title={titleInput} badge={badge} status={saveLabel} onClose={() => switchView({ full: false })}>
          {content}
        </WorkItemWindow>
      ) : (
        <WorkItemInline>
          <div className="mb-3">{titleInput}</div>
          {content}
        </WorkItemInline>
      )}
    </>
  );
}
