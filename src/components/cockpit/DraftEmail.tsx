"use client";

// The email staged on a task for a person to check and send: written here, by
// the in-app drafter, or by Claude through the MCP draft_email tool. It works
// like the client document: one line in the task, Show opens it in place, Open
// full over the whole screen (Derek, 2026-09-11: "make the draft emails work the
// same as the document ... just with a subject and email with attachments").
// Nothing sends on its own.
//
// The draft stays on the task until the email really went out: the check below
// retires it once an outbound email with the same subject and body exists, so a
// failed send, or cancelling the full composer, never loses it.
import { useEffect, useRef, useState } from "react";
import { STATUS_META, htmlToText, timeAgo, type Attachment, type Message, type Task } from "@/lib/data";
import { MAX_SHARED_FILE_BYTES, isShareableFileName } from "@/lib/uploadTypes";
import { RichTextEditor } from "./RichTextEditor";
import { useDebouncedCommit } from "./useDebouncedCommit";
import { FileDropLine, WorkItemBadge, WorkItemInline, WorkItemRow, WorkItemWindow, quietButton as quiet } from "./TaskWorkItem";
import { newId } from "./ui";

export type DraftEmailValue = NonNullable<Task["draftEmail"]>;

const normalize = (s: string) => htmlToText(s).replace(/\s+/g, " ").trim().toLowerCase();
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function DraftEmail({ task, onPatch, toEmail, onSend, onUpload, onMoreOptions, messages, openNonce, pushToast }: {
  task: Task;
  onPatch: (patch: Partial<Task>) => void;
  /** The linked contact's address, or null when there is nobody to send to yet. */
  toEmail: string | null;
  /** Missing when this teammate can't message this client. */
  onSend?: (subject: string, body: string, attachments?: Attachment[]) => void;
  onUpload?: (file: File) => Promise<Attachment | null>;
  /** Opens the task's full email composer (Cc, Bcc, scheduling) with this draft in it. */
  onMoreOptions?: (draft: DraftEmailValue) => void;
  messages?: Message[] | null;
  /** Bumped by the "+ Draft email" chip to show it. */
  openNonce: number;
  pushToast: (text: string) => void;
}) {
  const draft = task.draftEmail ?? null;
  const [shown, setShown] = useState(false);
  const [full, setFull] = useState(false);
  const [seenNonce, setSeenNonce] = useState(openNonce);
  const requested = openNonce !== seenNonce;
  // The inputs, reset whenever a different draft arrives (a new one from Claude
  // or the drafter replaces the old one and carries a new createdAt).
  const [local, setLocal] = useState({ key: draft?.createdAt ?? "", subject: draft?.subject ?? "", attachments: draft?.attachments ?? [] });
  if (draft && local.key !== draft.createdAt) setLocal({ key: draft.createdAt, subject: draft.subject, attachments: draft.attachments ?? [] });
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saved">("idle");
  const [uploading, setUploading] = useState(false);
  const [editorNonce, setEditorNonce] = useState(0);
  const pending = useRef<Partial<DraftEmailValue>>({});
  // Set once the draft is sent or discarded, so a save still waiting can't bring it back.
  const finished = useRef(false);
  const commit = useDebouncedCommit();

  const sentAlready = draft ? (messages ?? []).find((m) =>
    m.channel === "email" && m.direction === "outbound"
    && normalize(m.subject ?? "") === normalize(draft.subject) && normalize(m.body) === normalize(draft.body)) ?? null : null;
  useEffect(() => {
    // Idempotent, so two people with the task open both writing null is harmless.
    if (draft && sentAlready) onPatch({ draftEmail: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, !!draft, sentAlready?.id]);

  if (!draft) return null;

  // Every change is kept on the task a moment after the typing stops.
  const keep = (change: Partial<DraftEmailValue>) => {
    finished.current = false;
    pending.current = { ...pending.current, ...change };
    setSaveState("unsaved");
    const base = draft;
    commit.schedule(() => {
      if (finished.current) return;
      onPatch({ draftEmail: { ...base, ...pending.current, updatedAt: new Date().toISOString() } });
      pending.current = {};
      setSaveState("saved");
    });
  };
  // Switching views remounts the editor, so what is pending lands first.
  const switchView = (next: { shown?: boolean; full?: boolean }) => {
    commit.flush();
    if (requested) setSeenNonce(openNonce);
    if (next.shown !== undefined) setShown(next.shown);
    if (next.full !== undefined) setFull(next.full);
  };
  const isShown = shown || requested;
  const closeAll = () => { if (requested) setSeenNonce(openNonce); setShown(false); setFull(false); };

  const currentBody = () => pending.current.body ?? draft.body;
  const attachments = local.attachments;
  const setAttachments = (next: Attachment[]) => { setLocal((l) => ({ ...l, attachments: next })); keep({ attachments: next }); };

  const addFiles = async (list: FileList) => {
    if (!onUpload || uploading) return;
    setUploading(true);
    let next = attachments;
    for (const file of Array.from(list)) {
      if (!isShareableFileName(file.name)) { pushToast(`${file.name} can't be attached. Attach a photo, PDF, document, spreadsheet, slides or a video.`); continue; }
      if (file.size > MAX_SHARED_FILE_BYTES) { pushToast(`${file.name} is over 25 MB.`); continue; }
      const att = await onUpload(file);
      if (att) next = [...next, att];
    }
    setUploading(false);
    setAttachments(next);
  };

  // Something already on the task: a stored file goes in as an attachment (the
  // send route takes files kept under the task), a saved link goes at the end of
  // the email as a link.
  const taskFiles = task.attachments.filter((a) => a.path && !attachments.some((x) => x.path === a.path));
  const taskLinks = task.attachments.filter((a) => a.kind === "link" && a.url);
  const addFromTask = (a: Attachment) => {
    if (a.path) { setAttachments([...attachments, { ...a, id: newId("a_") }]); return; }
    if (!a.url) return;
    keep({ body: `${currentBody()}<p><a href="${escapeHtml(a.url)}">${escapeHtml(a.name || a.url)}</a></p>` });
    commit.flush();
    setEditorNonce((n) => n + 1);
  };

  const send = () => {
    if (!onSend || !toEmail) return;
    const body = currentBody();
    if (!htmlToText(body).trim() && attachments.length === 0) { pushToast("Write the email before sending it."); return; }
    // The subject it goes out with is the one kept, so the draft retires itself
    // once the sent email shows up on the task.
    const subject = local.subject.trim() || task.title;
    finished.current = true;
    onPatch({ draftEmail: { ...draft, ...pending.current, subject, body, attachments, updatedAt: new Date().toISOString() } });
    pending.current = {};
    onSend(subject, body, attachments.length ? attachments : undefined);
    closeAll();
  };
  const moreOptions = () => {
    if (!onMoreOptions) return;
    commit.flush();
    onMoreOptions({ ...draft, subject: local.subject, body: currentBody(), attachments });
    closeAll();
  };
  const discard = () => {
    if (!window.confirm("Discard this draft email?")) return;
    finished.current = true;
    pending.current = {};
    onPatch({ draftEmail: null });
    closeAll();
  };

  const count = attachments.length;
  const badge = <WorkItemBadge label="Not sent" chip={STATUS_META.todo.chip} dot={STATUS_META.todo.dot} />;
  const meta = [
    toEmail ? `To ${toEmail}` : "No linked contact to send to",
    count ? `${count} ${count === 1 ? "attachment" : "attachments"}` : null,
    `Edited ${timeAgo(draft.updatedAt ?? draft.createdAt)}`,
  ].filter(Boolean).join(" · ");
  const saveLabel = saveState === "unsaved" ? "Unsaved changes" : saveState === "saved" ? "Draft saved" : `Edited ${timeAgo(draft.updatedAt ?? draft.createdAt)}`;

  const row = (
    <WorkItemRow icon="✉️" title={local.subject.trim() || draft.subject.trim() || "Draft email"} badge={badge} meta={meta}
      shown={isShown} onToggle={() => switchView({ shown: !isShown })} onOpenFull={() => switchView({ full: true })} />
  );
  if (!isShown && !full) return row;

  const content = (
    <>
      <div className={full ? "overflow-hidden rounded-2xl border bg-surface shadow-sm" : "overflow-hidden rounded-xl border"}>
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-[16px] sm:px-6">
          <span className="w-16 shrink-0 font-semibold text-muted">To</span>
          {toEmail
            ? <span className="min-w-0 break-all">{toEmail}</span>
            : <span className="text-danger">No linked contact yet, so this can&apos;t be sent from here.</span>}
        </div>
        <label className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 sm:px-6">
          <span className="w-16 shrink-0 text-[16px] font-semibold text-muted">Subject</span>
          <input value={local.subject} onChange={(e) => { const subject = e.target.value; setLocal((l) => ({ ...l, subject })); keep({ subject }); }}
            placeholder={task.title} className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold outline-none" />
        </label>
        <div className="p-4 sm:p-6">
          <RichTextEditor key={`email-${local.key}-${editorNonce}-${full ? "full" : "inline"}`} value={draft.body} variant="doc" tall={full}
            placeholder="Write your email…" onChange={(html) => keep({ body: html })} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={send} disabled={!onSend || !toEmail}
          title={!toEmail ? "No linked contact to send to" : !onSend ? "You don't have permission to message this client" : undefined}
          className="rounded-lg bg-accent px-6 py-2.5 text-[16px] font-semibold text-white disabled:opacity-50">Send</button>
        {onMoreOptions && <button onClick={moreOptions} className={quiet}>Cc, Bcc or schedule</button>}
        <span className="text-[16px] text-muted">{saveLabel}</span>
        <button onClick={discard} className={`ml-auto ${quiet} hover:text-danger`}>Discard</button>
      </div>

      <div className="mt-5">
        <FileDropLine label="Attachments" count={count} busy={uploading} disabled={!onUpload} onFiles={(list) => void addFiles(list)}>
          {count > 0 && (
            <ul className="mt-1.5 divide-y">
              {attachments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[16px]">
                  <span className="min-w-0 break-words font-medium">{a.name}</span>
                  {a.size && <span className="text-muted">{a.size}</span>}
                  <button onClick={() => setAttachments(attachments.filter((x) => x.id !== a.id))} className="ml-auto text-muted hover:text-danger hover:underline">Remove</button>
                </li>
              ))}
            </ul>
          )}
          {(taskFiles.length > 0 || taskLinks.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-[16px]">
              <span className="text-muted">From this task:</span>
              {taskFiles.map((a) => (
                <button key={a.id} onClick={() => addFromTask(a)} title="Attach this file" className="rounded-full border px-3 py-0.5 hover:border-accent hover:text-accent">+ {a.name}</button>
              ))}
              {taskLinks.map((a) => (
                <button key={a.id} onClick={() => addFromTask(a)} title="Add this link to the end of the email" className="rounded-full border px-3 py-0.5 hover:border-accent hover:text-accent">🔗 {a.name || a.url}</button>
              ))}
            </div>
          )}
        </FileDropLine>
      </div>
    </>
  );

  return (
    <>
      {row}
      {full ? (
        <WorkItemWindow icon="✉️" badge={badge} status={saveLabel} onClose={() => switchView({ full: false })}
          title={
            <div>
              <p className="px-1 text-[22px] font-bold leading-tight">Draft email</p>
              <p className="truncate px-1 text-[16px] text-muted">{task.title}</p>
            </div>
          }>
          {content}
        </WorkItemWindow>
      ) : (
        <WorkItemInline>{content}</WorkItemInline>
      )}
    </>
  );
}
