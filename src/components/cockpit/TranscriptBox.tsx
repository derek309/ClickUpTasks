"use client";

// Add the transcript (Derek, 2026-10-15: "If it can't find the Granola
// transcript, how can I add it manually?"). Opens on the step when Granola
// finds nothing, isn't connected or fails, or when "Paste or drop it
// instead" skips Granola. Paste the text or drop the file, and the
// recording's link if there is one. Save transcript is the step's one dark
// button while it is open. Escape and Cancel close it and add nothing.
import { useRef, useState } from "react";
import { useEscapeToClose } from "./useEscapeToClose";
import { isTranscriptFile, textBytes, TRANSCRIPT_ACCEPT, TRANSCRIPT_MAX_BYTES } from "@/lib/transcriptPaste";

export type TranscriptEntry = { text: string; file: File | null; link: string };

const sizeOf = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function TranscriptBox({ reason, saving = false, onSave, onCancel, onWait }: {
  /** The one line under the heading: why it opened. */
  reason: string;
  saving?: boolean;
  onSave: (entry: TranscriptEntry) => void;
  /** Closed with Cancel or Escape: nothing is added. */
  onCancel: () => void;
  /** Granola files it on this step after the meeting: close and keep waiting. */
  onWait?: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  useEscapeToClose(onCancel);

  const takeFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!isTranscriptFile(f.name)) { setProblem("That isn't a transcript file. Use .txt, .vtt, .srt, .docx, .pdf or .md."); return; }
    setProblem(null);
    setFile(f);
  };
  const tooBig = !file && textBytes(text) > TRANSCRIPT_MAX_BYTES;
  const ready = (!!file || text.trim().length > 0) && !tooBig && !saving;
  const save = () => { if (ready) onSave({ text: file ? "" : text, file, link }); };

  return (
    <section aria-label="Add the transcript" data-transcript-box
      // Dropped or pasted files are this box's, not the step's: the drawer
      // leaves an event handled here alone (defaultPrevented).
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); setOver(false); takeFile(e.dataTransfer.files[0]); }}
      onPaste={(e) => { const f = Array.from(e.clipboardData?.files ?? [])[0]; if (f) { e.preventDefault(); takeFile(f); } }}
      className={`flex w-full min-w-0 max-w-full flex-col gap-3 rounded-[5px] border bg-surface p-3 sm:p-4 ${over ? "ring-2 ring-accent" : ""}`}>
      <div className="flex flex-col gap-1">
        <h3 className="text-[17px] font-bold">Add the transcript</h3>
        <p className="text-[16px] text-muted">{reason}</p>
      </div>
      {file ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[5px] bg-background px-3 py-2 text-[16px]">
          <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
          <span className="text-muted">{sizeOf(file.size)}</span>
          <button type="button" onClick={() => setFile(null)} className="font-semibold text-accent underline-offset-4 hover:underline">Remove</button>
        </div>
      ) : (
        <>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Paste the transcript" placeholder="Paste the transcript"
            rows={8} className="min-h-[160px] w-full min-w-0 resize-y rounded-[5px] border bg-surface px-3 py-2 text-[16px] leading-relaxed outline-none focus:border-accent" />
          {tooBig && <p className="text-[16px] font-semibold text-danger">That is over 2 MB. Drop it as a file instead.</p>}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[5px] border border-dashed px-3 py-2.5 text-[16px] text-muted">
            <span>Drop the file here, or</span>
            <button type="button" onClick={() => pick.current?.click()} className="font-semibold text-accent underline-offset-4 hover:underline">Choose a file</button>
            <span className="basis-full">.txt, .vtt, .srt, .docx, .pdf or .md</span>
            <input ref={pick} type="file" accept={TRANSCRIPT_ACCEPT} className="hidden" aria-label="Transcript file"
              onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </>
      )}
      <label className="flex min-w-0 flex-col gap-1 text-[16px]">
        <span className="font-semibold">Recording link <span className="font-normal text-muted">(optional)</span></span>
        <input value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" aria-label="Recording link"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
          placeholder="Fathom, Zoom, Granola or YouTube" className="w-full min-w-0 rounded-[5px] border bg-surface px-3 py-2 text-[16px] outline-none focus:border-accent" />
      </label>
      {problem && <p role="alert" className="text-[16px] font-semibold text-danger">{problem}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={save} disabled={!ready}
          className="min-h-10 rounded-[5px] bg-accent px-4 py-1.5 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-50">{saving ? "Saving…" : "Save transcript"}</button>
        <button type="button" onClick={onCancel} className="min-h-10 text-[16px] font-medium text-muted hover:text-foreground">Cancel</button>
        {onWait && <button type="button" onClick={onWait} title="Granola adds it to this step after the meeting" className="min-h-10 text-[16px] font-medium text-accent underline-offset-4 hover:underline">Wait for Granola</button>}
      </div>
    </section>
  );
}

/** A step waiting on its transcript, box closed: one quiet line to skip
 *  Granola and add it now. */
export function TranscriptWaitLine({ onPaste }: { onPaste: () => void }) {
  return (
    <p className="text-[16px] text-muted">
      Granola adds the transcript here after the meeting.{" "}
      <button type="button" onClick={onPaste} className="font-semibold text-accent underline-offset-4 hover:underline">Paste or drop it instead</button>
    </p>
  );
}
