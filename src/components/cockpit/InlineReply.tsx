"use client";

// Reply in place (Derek, 2026-10-15, step-flow-mockup.html): Reply on the
// client's email opens this box right under it, To and the subject filled
// in, no trip to the email window. To is the person who wrote the email, by
// name and address, with the others on it in Cc (reply all); Cc and Bcc are
// changed right here (Derek, 2026-10-16). It writes the task's draft email (the same
// one the window edits), saving as you type, and Send sends it the way the
// window's Send does (TaskDrawer sendDraft): the step finishes and After this
// starts. Full window ↗ opens the window on the same draft for the task's
// files and the rest. While it is open, Send is the page's one dark button.
// Left as Reply wrote it (clicking away, Escape, Discard), the reply takes
// itself back (onLeave, lib/undoAction).
import { useEffect, useRef, useState } from "react";
import { MAX_SHARED_FILE_BYTES, isShareableFileName } from "@/lib/uploadTypes";
import { plainTextToHtml, type Attachment, type Contact } from "@/lib/data";
import { EmailAttachments, useFileThumbs } from "./EmailAttachments";
import { RichTextEditor } from "./RichTextEditor";
import { RecipientField } from "./EmailWindow";
import { I } from "./ui";

// The subject's height follows its text, where [field-sizing:content] is not supported.
const fitHeight = (t: HTMLTextAreaElement | null) => {
  if (!t || (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content"))) return;
  t.style.height = "auto";
  t.style.height = `${t.scrollHeight}px`;
};

export type ReplyDraft = { subject: string; body: string; attachments?: Attachment[]; cc?: string[]; bcc?: string[] };

export function InlineReply({ toName, toEmail, draft, ccContacts, onSave, onSend, onAi, onUpload, onFull, onDiscard, onLeave, note, pushToast }: {
  /** Who it goes to: their name, and their address. */
  toName: string | null;
  toEmail: string | null;
  /** Searchable contacts for Cc and Bcc. */
  ccContacts?: Contact[];
  draft: ReplyDraft;
  /** Saves the draft (called a moment after typing stops, and before Send). */
  onSave: (patch: Partial<ReplyDraft>) => void;
  onSend: () => void;
  /** Writes it with AI, as the window's Write with AI does. */
  onAi?: () => Promise<{ subject?: string; body: string } | null>;
  onUpload?: (file: File) => Promise<Attachment | null>;
  /** The full email window, on this same draft. */
  onFull: () => void;
  onDiscard: () => void;
  /** Focus left the box (anything typed is saved first). */
  onLeave?: () => void;
  /** Under Send: what sending does to the steps. */
  note?: string | null;
  pushToast: (text: string) => void;
}) {
  const pending = useRef<Partial<ReplyDraft> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nonce, setNonce] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cc, setCc] = useState<string[]>(draft.cc ?? []);
  const [bcc, setBcc] = useState<string[]>(draft.bcc ?? []);
  const [showCopies, setShowCopies] = useState(!!(draft.cc?.length || draft.bcc?.length));
  const who = toName || toEmail || "them";
  const saveCopies = (next: { cc?: string[]; bcc?: string[] }) => {
    if (next.cc) setCc(next.cc);
    if (next.bcc) setBcc(next.bcc);
    flush();
    onSave(next);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  // Clicking away from the box: not into it, and not to another window.
  const left = () => setTimeout(() => {
    if (!onLeave || !document.hasFocus() || boxRef.current?.contains(document.activeElement)) return;
    flush();
    onLeave();
  }, 0);
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current) { const p = pending.current; pending.current = null; onSave(p); }
  };
  const keep = (p: Partial<ReplyDraft>) => {
    pending.current = { ...(pending.current ?? {}), ...p };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  // Closing the page right after typing still saves it.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const atts = draft.attachments ?? [];
  const thumbs = useFileThumbs(atts);
  const writeWithAi = async () => {
    if (!onAi || aiBusy) return;
    flush();
    setAiBusy(true);
    const d = await onAi().catch(() => null);
    setAiBusy(false);
    if (!d) { pushToast("Couldn't write it with AI just now."); return; }
    const body = plainTextToHtml(d.body);
    onSave({ body, ...(d.subject?.trim() ? { subject: d.subject.trim() } : {}) });
    setNonce((n) => n + 1);
  };
  const addFiles = async (list: FileList) => {
    if (!onUpload || uploading) return;
    setUploading(true);
    let next = atts;
    for (const file of Array.from(list)) {
      if (!isShareableFileName(file.name)) { pushToast(`${file.name} can't be attached. Attach a photo, PDF, document, spreadsheet, slides or a video.`); continue; }
      if (file.size > MAX_SHARED_FILE_BYTES) { pushToast(`${file.name} is over 25 MB.`); continue; }
      const a = await onUpload(file);
      if (a) next = [...next, a];
    }
    setUploading(false);
    flush();
    onSave({ attachments: next });
  };
  const link = "inline-flex min-h-9 items-center gap-1 rounded-[5px] px-1 text-[16px] font-semibold text-accent hover:bg-background disabled:opacity-50";
  return (
    <section ref={boxRef} aria-label={`Reply to ${who}`} className="overflow-hidden rounded-[5px] bg-surface ring-2 ring-inset ring-accent"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) left(); }}
      // Escape: what was typed is saved first, then the key goes on (the
      // task drawer takes the reply back when nothing was).
      onKeyDown={(e) => { if (e.key === "Escape") flush(); }}>
      {/* To, Cc, Bcc and the subject, one line each with the labels in one
          column, as in the email window. The address sits under the name on
          a phone and after it on a desktop; the subject wraps, never cut off. */}
      <div className="border-b text-[16px]">
        <div className="flex items-start gap-3 px-3 py-2 sm:items-center">
          <span className="w-16 shrink-0 font-semibold text-muted">To</span>
          {toEmail
            ? (
              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
                {toName && <span className="font-semibold [overflow-wrap:anywhere]">{toName}</span>}
                <span className={`[overflow-wrap:anywhere] ${toName ? "text-muted" : ""}`}>{toEmail}</span>
              </span>
            )
            : <span className="min-w-0 flex-1 text-danger">Nobody to send this to yet.</span>}
          {!showCopies && (
            <button onClick={() => setShowCopies(true)} className="-my-1 min-h-9 shrink-0 rounded-[5px] px-2 font-medium text-muted hover:bg-background hover:text-foreground">Cc / Bcc</button>
          )}
        </div>
        {showCopies && (
          <div className="flex flex-col gap-2 border-t px-3 py-2">
            <RecipientField label="Cc" value={cc} onChange={(next) => saveCopies({ cc: next })} contacts={ccContacts ?? []} />
            <RecipientField label="Bcc" value={bcc} onChange={(next) => saveCopies({ bcc: next })} contacts={ccContacts ?? []} />
          </div>
        )}
        <label className="flex items-start gap-3 border-t px-3 py-2">
          <span className="w-16 shrink-0 py-0.5 font-semibold text-muted">Subject</span>
          {/* Wraps instead of running off the edge; still one line: Enter adds none. */}
          <textarea defaultValue={draft.subject} key={`s${nonce}`} rows={1} aria-label="Subject" ref={fitHeight}
            onChange={(e) => { const v = e.target.value.replace(/\s*\n\s*/g, " "); if (v !== e.target.value) e.target.value = v; fitHeight(e.target); keep({ subject: v }); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault(); }}
            className="min-w-0 flex-1 resize-none bg-transparent py-0.5 font-medium leading-snug text-foreground outline-none [field-sizing:content]" />
        </label>
      </div>
      <div className="px-1 py-1 text-[16px]">
        <RichTextEditor key={`b${nonce}`} variant="email" value={draft.body} autoFocus onChange={(html) => keep({ body: html })} placeholder={`Write to ${who}`} />
      </div>
      {/* What is attached, as pictures with an × each, as in the email window
          (Derek, 2026-10-17). The task's own files are in Full window. */}
      {atts.length > 0 && (
        <div className="border-t px-3 py-2">
          <p className="text-[16px] font-semibold">Attached · {atts.length}</p>
          <EmailAttachments attached={atts} thumbs={thumbs} onRemove={(a) => { flush(); onSave({ attachments: atts.filter((x) => x.id !== a.id) }); }} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-background/60 px-3 py-2">
        <button onClick={() => { flush(); onSend(); }} className="h-10 rounded-[5px] bg-accent px-4 text-[16px] font-semibold text-white hover:opacity-90">Send</button>
        {onAi && <button onClick={() => void writeWithAi()} disabled={aiBusy} className={link}><span aria-hidden>✨</span>{aiBusy ? "Writing…" : <><span className="sm:hidden">AI</span><span className="max-sm:hidden">Write with AI</span></>}</button>}
        {onUpload && <>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className={link}><I.clip className="h-4 w-4" />{uploading ? "Adding…" : "Attach"}</button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.target.value = ""; }} />
        </>}
        <span className="flex-1" />
        <button onClick={() => { flush(); onDiscard(); }} className="min-h-9 px-1 text-[16px] font-medium text-muted hover:text-danger">Discard</button>
        <button onClick={() => { flush(); onFull(); }} title="The email window, with the task's files and scheduling" className="min-h-9 px-1 text-[16px] font-medium text-muted hover:text-foreground">
          <span className="sm:hidden">Full ↗</span><span className="max-sm:hidden">Full window ↗</span></button>
      </div>
      {note && <p className="border-t px-3 py-2 text-[16px] text-muted">{note}</p>}
    </section>
  );
}
