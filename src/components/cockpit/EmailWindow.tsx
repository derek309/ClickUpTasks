"use client";

// The one window for writing an email to a client (Derek, 2026-09-11: "can we
// make this the default look for emailing all around?"). A task's draft email,
// Email and Reply on a task, the client Journal's Email and Reply, and Remind
// client all open it. Texts and chats keep their small box.
//
// The caller owns where the draft is kept (a task's draft_email, or the client's
// row in client_email_drafts); every change is saved there a moment after the
// typing stops. Nothing sends on its own.
import { useEffect, useRef, useState } from "react";
import {
  STATUS_META, htmlToText, looksLikeHtml, plainTextToHtml, timeAgo,
  type Attachment, type Contact, type EmailDraft, type Message, type ScheduledMessage,
} from "@/lib/data";
import { authedFetch } from "@/lib/supabase";
import { safeMessageHtml } from "@/lib/safeHtml";
import { MAX_SHARED_FILE_BYTES, isPreviewableImage, isShareableFileName } from "@/lib/uploadTypes";
import { signedUrlForFile } from "@/lib/db";
import { placeDraftLink, draftLinkAsButton, escapeHtml } from "@/lib/draftLink";
import { RichTextEditor } from "./RichTextEditor";
import { useDebouncedCommit } from "./useDebouncedCommit";
import { SchedulePopover } from "./SchedulePopover";
import {
  FileDropLine, ImageLightbox, ImageThumbGrid, WorkItemBadge, WorkItemWindow,
  quietButton as quiet, type PreviewImage,
} from "./TaskWorkItem";
import { newId } from "./ui";

/** replyTo: messages.id this answers, so the send routes thread it as a reply. */
export type OutgoingEmail = { subject: string; body: string; attachments: Attachment[]; cc: string[]; bcc: string[]; replyTo: string | null };

const normalize = (s: string) => htmlToText(s).replace(/\s+/g, " ").trim().toLowerCase();

/** The outbound email this draft became, once it went out. Send turns the link
 *  line into a button (draftLink.ts), so that is the version compared. */
export function sentEmailFor(draft: EmailDraft, messages: Message[] | null | undefined): Message | null {
  const subject = normalize(draft.subject);
  const body = normalize(draftLinkAsButton(draft.body, draft.link));
  return (messages ?? []).find((m) => m.channel === "email" && m.direction === "outbound"
    && normalize(m.subject ?? "") === subject && normalize(m.body) === body) ?? null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Cc and Bcc: type to search the synced contacts by name or email, or type an
// address and press Enter. Stores plain email strings (what GHL and Gmail take).
function RecipientField({ label, value, onChange, contacts }: { label: string; value: string[]; onChange: (next: string[]) => void; contacts: Contact[] }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const matches = ql
    ? contacts.filter((c) => c.email && !value.includes(c.email) && (c.name.toLowerCase().includes(ql) || c.email.toLowerCase().includes(ql))).slice(0, 6)
    : [];
  const add = (email: string) => { const e = email.trim(); if (e && !value.includes(e)) onChange([...value, e]); setQ(""); };
  const remove = (email: string) => onChange(value.filter((x) => x !== email));
  return (
    <div className="relative flex flex-wrap items-center gap-3">
      <span className="w-16 shrink-0 text-[16px] font-semibold text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {value.map((e) => (
          <span key={e} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-[16px] text-accent">
            {e}<button onClick={() => remove(e)} title="Remove" className="hover:text-foreground">×</button>
          </span>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && EMAIL_RE.test(q.trim())) { e.preventDefault(); add(q); }
            else if (e.key === "Backspace" && !q && value.length) { remove(value[value.length - 1]); }
          }}
          placeholder={value.length ? "" : "Search contacts or type an email"}
          className="min-w-[180px] flex-1 bg-transparent py-0.5 text-[16px] outline-none placeholder:text-muted" />
      </div>
      {matches.length > 0 && (
        <div className="absolute left-16 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-surface shadow-lg">
          {matches.map((c) => (
            <button key={c.id} onClick={() => add(c.email)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-background">
              <span className="truncate text-[16px] font-medium">{c.name}</span>
              <span className="shrink-0 truncate text-[16px] text-muted">{c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmailWindow({
  draft, save, onClose, onDiscard, onSend, onSchedule, toEmail, heading, subheading, subjectFallback,
  ccContacts, onUpload, onAiDraft, writeOnOpen, taskItems, scheduled, onCancelScheduled, pushToast,
}: {
  draft: EmailDraft;
  /** Keeps the draft: a task's draft_email, or the client's saved draft. */
  save: (next: EmailDraft) => void;
  onClose: () => void;
  /** Removes the kept draft. */
  onDiscard: () => void;
  /** Missing when this teammate can't message this client. */
  onSend?: (email: OutgoingEmail) => void;
  onSchedule?: (email: OutgoingEmail, whenIso: string) => void;
  toEmail: string | null;
  heading: string;
  subheading?: string;
  /** The subject a blank one goes out with. Without it a subject is required. */
  subjectFallback?: string;
  ccContacts?: Contact[];
  onUpload?: (file: File) => Promise<Attachment | null>;
  onAiDraft?: (instruction: string, context?: string) => Promise<{ subject?: string; body: string } | null>;
  /** Writes the email with AI as soon as it opens (a document just sent for review). */
  writeOnOpen?: boolean;
  /** Files and links already on the task, added with one click. */
  taskItems?: Attachment[];
  scheduled?: ScheduledMessage[];
  onCancelScheduled?: (id: string) => void;
  pushToast: (text: string) => void;
}) {
  const [subject, setSubjectState] = useState(draft.subject);
  const [attachments, setAttachmentsState] = useState<Attachment[]>(draft.attachments ?? []);
  const [cc, setCcState] = useState<string[]>(draft.cc ?? []);
  const [bcc, setBccState] = useState<string[]>(draft.bcc ?? []);
  const [showCopies, setShowCopies] = useState(!!(draft.cc?.length || draft.bcc?.length));
  const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saved">("idle");
  const [uploading, setUploading] = useState(false);
  const [editorNonce, setEditorNonce] = useState(0);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  // Signed links for image thumbnails, by storage path, and the open preview.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<number | null>(null);
  // The kept draft as of the last render, for saves and AI results that land after it changed.
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; });
  // The sender's signature, shown under the email as it will go out (Derek,
  // 2026-09-11). The send routes add it (emailSignature.ts); the window always
  // sends as the person using it, so their own signature is the right one.
  const [signature, setSignature] = useState("");
  useEffect(() => {
    let cancelled = false;
    void authedFetch("/api/signature").then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && typeof j?.signature === "string") setSignature(j.signature); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const pending = useRef<Partial<EmailDraft>>({});
  // Set once the email is sent, scheduled or discarded, so a save still waiting can't bring it back.
  const finished = useRef(false);
  const commit = useDebouncedCommit();

  // Typing is never left waiting: the pending save lands when the tab is hidden,
  // the page closes, or the window closes (the commit hook flushes on unmount).
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") commit.flush(); };
    window.addEventListener("pagehide", commit.flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", commit.flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [commit.flush]); // eslint-disable-line react-hooks/exhaustive-deps

  const keep = (change: Partial<EmailDraft>) => {
    pending.current = { ...pending.current, ...change };
    setSaveState("unsaved");
    commit.schedule(() => {
      if (finished.current) return;
      save({ ...draftRef.current, ...pending.current, updatedAt: new Date().toISOString() });
      pending.current = {};
      setSaveState("saved");
    });
  };
  const currentBody = () => pending.current.body ?? draftRef.current.body;

  // Write (or rewrite) the email with AI. The draft's link goes back where the AI
  // marked it, so the client always gets it however many times it is rewritten.
  const writeWithAi = async (instruction: string) => {
    if (!onAiDraft || aiBusy) return;
    commit.flush();
    setAiBusy(true);
    const context = draftRef.current.aiContext;
    const ask = instruction || (context ? "Write the email this context describes: short, friendly, and asking them to open the link below." : "");
    const d = await onAiDraft(ask, context);
    setAiBusy(false);
    if (!d || finished.current) return;
    const latest = draftRef.current;
    const nextSubject = d.subject?.trim() || latest.subject;
    pending.current = {};
    save({ ...latest, subject: nextSubject, body: placeDraftLink(plainTextToHtml(d.body), latest.link), updatedAt: new Date().toISOString() });
    setSubjectState(nextSubject);
    setEditorNonce((n) => n + 1);
    setSaveState("saved");
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (writeOnOpen) void writeWithAi(""); }, []);

  const imagePaths = attachments.filter((a) => a.path && isPreviewableImage(a.name)).map((a) => a.path!).join("|");
  useEffect(() => {
    const missing = imagePaths ? imagePaths.split("|").filter((p) => !thumbs[p]) : [];
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async (p) => [p, await signedUrlForFile(p, 3600)] as const)).then((pairs) => {
      if (!cancelled) setThumbs((t) => ({ ...t, ...Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => !!pair[1])) }));
    });
    return () => { cancelled = true; };
  }, [imagePaths]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSubject = (next: string) => { setSubjectState(next); keep({ subject: next }); };
  const setAttachments = (next: Attachment[]) => { setAttachmentsState(next); keep({ attachments: next }); };
  const setCc = (next: string[]) => { setCcState(next); keep({ cc: next }); };
  const setBcc = (next: string[]) => { setBccState(next); keep({ bcc: next }); };

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
  const taskFiles = (taskItems ?? []).filter((a) => a.path && !attachments.some((x) => x.path === a.path));
  const taskLinks = (taskItems ?? []).filter((a) => a.kind === "link" && a.url);
  const addFromTask = (a: Attachment) => {
    if (a.path) { setAttachments([...attachments, { ...a, id: newId("a_") }]); return; }
    if (!a.url) return;
    keep({ body: `${currentBody()}<p><a href="${escapeHtml(a.url)}">${escapeHtml(a.name || a.url)}</a></p>` });
    commit.flush();
    setEditorNonce((n) => n + 1);
  };

  const outgoing = (): OutgoingEmail | null => {
    const body = draftLinkAsButton(currentBody(), draftRef.current.link);
    if (!htmlToText(body).trim() && attachments.length === 0) { pushToast("Write the email before sending it."); return null; }
    const finalSubject = subject.trim() || subjectFallback?.trim() || "";
    if (!finalSubject) { pushToast("Add a subject before sending."); return null; }
    return { subject: finalSubject, body, attachments, cc, bcc, replyTo: draftRef.current.replyTo ?? null };
  };
  // What goes out is kept as the draft first, so it retires itself once the sent
  // email shows up (sentEmailFor), and a failed send still has it.
  const send = () => {
    if (!onSend || !toEmail) return;
    const email = outgoing();
    if (!email) return;
    finished.current = true;
    save({ ...draftRef.current, ...pending.current, subject: email.subject, body: currentBody(), attachments, cc, bcc, updatedAt: new Date().toISOString() });
    pending.current = {};
    onSend(email);
    onClose();
  };
  // A scheduled email leaves no sent message to match until it goes out, so its draft clears now.
  const schedule = (whenIso: string) => {
    if (!onSchedule || !toEmail) return;
    const email = outgoing();
    if (!email) return;
    finished.current = true;
    pending.current = {};
    onSchedule(email, whenIso);
    onDiscard();
    onClose();
  };
  const discard = () => {
    if (!window.confirm("Discard this email?")) return;
    finished.current = true;
    pending.current = {};
    onDiscard();
    onClose();
  };

  const count = attachments.length;
  const previewImages: PreviewImage[] = attachments
    .filter((a) => a.path && isPreviewableImage(a.name) && thumbs[a.path])
    .map((a) => ({ id: a.id, name: a.name, url: thumbs[a.path!] }));
  const badge = <WorkItemBadge label="Not sent" chip={STATUS_META.todo.chip} dot={STATUS_META.todo.dot} />;
  const saveLabel = saveState === "unsaved" ? "Unsaved changes" : saveState === "saved" ? "Draft saved" : `Edited ${timeAgo(draft.updatedAt ?? draft.createdAt)}`;
  const cannotSend = !toEmail ? "No linked contact to send to" : !onSend ? "You don't have permission to message this client" : undefined;

  return (
    <>
      <WorkItemWindow icon="✉️" badge={badge} onClose={onClose}
        title={
          <div>
            <p className="px-1 text-[22px] font-bold leading-tight">{heading}</p>
            {subheading && <p className="truncate px-1 text-[16px] text-muted">{subheading}</p>}
          </div>
        }>
        {/* Attachments sit in a right column beside the email, like the client document. */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            {onAiDraft && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 px-3 py-2">
                <span aria-hidden className="text-[18px]">✨</span>
                <input value={aiInstruction} onChange={(e) => setAiInstruction(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void writeWithAi(aiInstruction.trim()); } }}
                  placeholder={draft.aiContext ? "Tell AI anything to add, or leave it blank" : "Tell AI what this email should say, or leave it blank for a status update"}
                  aria-label="Tell AI what to write" disabled={aiBusy}
                  className="min-w-0 flex-1 bg-transparent py-1 text-[16px] outline-none" />
                <button onClick={() => void writeWithAi(aiInstruction.trim())} disabled={aiBusy}
                  className="rounded-lg bg-accent px-4 py-1.5 text-[16px] font-semibold text-white disabled:opacity-50">
                  {aiBusy ? "Writing…" : "Write with AI"}
                </button>
              </div>
            )}
            <div className="overflow-hidden rounded-2xl border bg-surface shadow-sm">
              <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-[16px] sm:px-6">
                <span className="w-16 shrink-0 font-semibold text-muted">To</span>
                {toEmail
                  ? <span className="min-w-0 flex-1 break-all">{toEmail}</span>
                  : <span className="min-w-0 flex-1 text-danger">No linked contact yet, so this can&apos;t be sent from here.</span>}
                {!showCopies && <button onClick={() => setShowCopies(true)} className="shrink-0 font-medium text-accent hover:underline">Cc / Bcc</button>}
              </div>
              {showCopies && (
                <div className="flex flex-col gap-2 border-b px-4 py-2.5 sm:px-6">
                  <RecipientField label="Cc" value={cc} onChange={setCc} contacts={ccContacts ?? []} />
                  <RecipientField label="Bcc" value={bcc} onChange={setBcc} contacts={ccContacts ?? []} />
                </div>
              )}
              <label className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5 sm:px-6">
                <span className="w-16 shrink-0 text-[16px] font-semibold text-muted">Subject</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)}
                  placeholder={subjectFallback || "Subject"} className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold outline-none" />
              </label>
              <div className="p-4 sm:p-6" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } }}>
                <RichTextEditor key={`email-${editorNonce}`} value={draft.body} variant="doc"
                  placeholder="Write your email…" onChange={(html) => keep({ body: html })} />
              </div>
              {signature.trim() && (
                <div className="border-t px-4 py-3 text-[16px] text-muted sm:px-6" title="Added when it sends. Change it in Settings.">
                  <div className="rte-content" dangerouslySetInnerHTML={{ __html: safeMessageHtml(looksLikeHtml(signature) ? signature : plainTextToHtml(signature)) }} />
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={send} disabled={!!cannotSend} title={cannotSend}
                className="rounded-lg bg-accent px-6 py-2.5 text-[16px] font-semibold text-white disabled:opacity-50">Send</button>
              {onSchedule && toEmail && <SchedulePopover onSchedule={schedule} />}
              <span className="text-[16px] text-muted">{saveLabel}</span>
              <button onClick={discard} className={`ml-auto ${quiet} hover:text-danger`}>Discard</button>
            </div>
          </div>

          <div className="space-y-4 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto">
            <FileDropLine label="Attachments" count={count} busy={uploading} disabled={!onUpload} onFiles={(list) => void addFiles(list)}>
              {previewImages.length > 0 && <ImageThumbGrid images={previewImages} onOpen={setLightbox} />}
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
            {scheduled && scheduled.length > 0 && (
              <div className="rounded-2xl border bg-surface p-4">
                <p className="text-[16px] font-semibold">Scheduled</p>
                <ul className="mt-1 divide-y">
                  {scheduled.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[16px]">
                      <span className="min-w-0 flex-1">{new Date(s.scheduledAt).toLocaleString()}</span>
                      {onCancelScheduled && <button onClick={() => onCancelScheduled(s.id)} className="font-medium text-accent hover:underline">Cancel</button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </WorkItemWindow>
      {lightbox !== null && previewImages[lightbox] && (
        <ImageLightbox images={previewImages} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}
