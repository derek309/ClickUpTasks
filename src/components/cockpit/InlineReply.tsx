"use client";

// Reply in place (Derek, 2026-10-15, step-flow-mockup.html): Reply on the
// client's email opens this box right under it, To and the subject filled
// in, no trip to the email window. It writes the task's draft email (the same
// one the window edits), saving as you type, and Send sends it the way the
// window's Send does (TaskDrawer sendDraft): the step finishes and After this
// starts. Full window ↗ opens the window on the same draft for Cc, the task's
// files and the rest. While it is open, Send is the page's one dark button.
import { useEffect, useRef, useState } from "react";
import { MAX_SHARED_FILE_BYTES, isShareableFileName } from "@/lib/uploadTypes";
import { plainTextToHtml, type Attachment } from "@/lib/data";
import { RichTextEditor } from "./RichTextEditor";
import { I } from "./ui";

export type ReplyDraft = { subject: string; body: string; attachments?: Attachment[] };

export function InlineReply({ toName, draft, onSave, onSend, onAi, onUpload, onFull, onDiscard, note, pushToast }: {
  toName: string;
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
  /** Under Send: what sending does to the steps. */
  note?: string | null;
  pushToast: (text: string) => void;
}) {
  const pending = useRef<Partial<ReplyDraft> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nonce, setNonce] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
    <section aria-label={`Reply to ${toName}`} className="overflow-hidden rounded-[5px] bg-surface ring-2 ring-inset ring-accent">
      <div className="border-b px-3 py-2 text-[16px] text-muted [overflow-wrap:anywhere]">
        To <span className="font-semibold text-foreground">{toName}</span>
        <span aria-hidden> · </span>
        <input defaultValue={draft.subject} key={`s${nonce}`} aria-label="Subject" onChange={(e) => keep({ subject: e.target.value })}
          className="w-full min-w-0 bg-transparent font-medium text-foreground outline-none sm:w-auto sm:min-w-[16rem]" />
      </div>
      <div className="px-1 py-1 text-[16px]">
        <RichTextEditor key={`b${nonce}`} variant="email" value={draft.body} autoFocus onChange={(html) => keep({ body: html })} placeholder={`Write to ${toName}`} />
      </div>
      {atts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t px-3 py-2">
          {atts.map((a) => (
            <span key={a.id} className="inline-flex max-w-full items-center gap-1.5 rounded-[5px] bg-background py-1 pl-2.5 pr-1 text-[16px]">
              <I.clip className="h-4 w-4 shrink-0 text-muted" /><span className="min-w-0 truncate">{a.name}</span>
              <button onClick={() => { flush(); onSave({ attachments: atts.filter((x) => x.id !== a.id) }); }} aria-label={`Remove ${a.name}`} className="shrink-0 rounded px-1 text-muted hover:text-danger">×</button>
            </span>
          ))}
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
        <button onClick={() => { flush(); onFull(); }} title="The email window, with Cc, the task's files and scheduling" className="min-h-9 px-1 text-[16px] font-medium text-muted hover:text-foreground">
          <span className="sm:hidden">Full ↗</span><span className="max-sm:hidden">Full window ↗</span></button>
      </div>
      {note && <p className="border-t px-3 py-2 text-[16px] text-muted">{note}</p>}
    </section>
  );
}
