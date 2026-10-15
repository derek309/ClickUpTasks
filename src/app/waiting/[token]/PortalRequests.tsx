"use client";

// What we need from the client, one thing at a time (Derek and Justin,
// 2026-10-15, client-reminders-mockup.html section 4): the one request a
// reminder's link opens, then the next once it is answered, and the full
// list grouped Overdue, Today, This week and Later in our own order. Every
// answer goes through the portal's own paths (WaitingView's messages, upload
// and review links), so the step finishes on the server as before.
import { useRef } from "react";
import { expectedLine, firstAskedLine, groupedQueue, rowDate, stateWord, type PortalRequest } from "@/lib/portalRequests";

type DraftFile = { id: string; name: string; size: string };

const TONE = { late: "text-danger", today: "text-highlight", plain: "text-muted" } as const;
/** The thing a review holds, for "Open the design to look it over". */
const REVIEW_NOUN: Record<string, string> = { doc: "document", image: "design", page: "page", video: "video" };

/** One request, on its own, with one dark button for the answer. */
export function FocusedRequest({
  r, today, listName, review, body, files, uploading, sending, error, changesOpen, opening, approving = false,
  onBody, onFiles, onRemoveFile, onAnswer, onOpenReview, onApprove, onAskChanges, onReadEmail,
}: {
  r: PortalRequest;
  today: string;
  listName: string | null;
  /** The review it holds (doc, image, page, video), when it is one. */
  review: string | null;
  body: string;
  files: DraftFile[];
  uploading: boolean;
  sending: boolean;
  error?: string;
  changesOpen: boolean;
  opening: boolean;
  /** One tap Approve is on its way. */
  approving?: boolean;
  onBody: (v: string) => void;
  onFiles: (f: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  /** Sends what they wrote or added (the answer, or the changes). */
  onAnswer: () => void;
  onOpenReview: () => void;
  /** Approves the review there and then (lib/portalApprove); without it,
   *  Approve opens the review as before. */
  onApprove?: () => void;
  onAskChanges: () => void;
  /** Opens the conversation, where our email reads in full. */
  onReadEmail?: () => void;
}) {
  const word = stateWord(r.needBy, today);
  const asked = firstAskedLine(r.startedAt);
  const expected = expectedLine(r.taskTitle, r.taskDue);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isReview = r.kind === "review";
  const canSend = !sending && !uploading && (!!body.trim() || files.length > 0);
  const dark = "flex h-12 w-full items-center justify-center rounded-[5px] bg-accent px-4 text-[16px] font-bold text-white hover:opacity-90 disabled:opacity-40";
  const fileList = files.length > 0 && (
    <ul className="mt-2 grid gap-1.5">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-2 rounded-[5px] border bg-background px-3 py-2 text-[16px]">
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="shrink-0 text-muted">{f.size}</span>
          <button onClick={() => onRemoveFile(f.id)} aria-label={`Remove ${f.name}`} className="shrink-0 px-1 text-muted hover:text-danger">✕</button>
        </li>
      ))}
    </ul>
  );
  const picker = <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />;
  return (
    <div>
      <div className="rounded-[5px] bg-surface p-4 ring-2 ring-inset ring-accent">
        {word && <div className={`text-[16px] font-bold ${TONE[word.tone]}`}>{word.text}</div>}
        <h1 className="mt-0.5 break-words text-[20px] font-bold leading-snug">{r.ask}</h1>
        {/* The task's name only ever as this small line, never the title. */}
        <div className="mt-1 text-[16px] text-muted [overflow-wrap:anywhere]">{[r.taskTitle.trim(), listName, asked].filter(Boolean).join(" · ")}</div>
        {r.replyTo && (
          <div className="mt-3 rounded-[5px] bg-background px-3 py-2.5 text-[16px] ring-1 ring-inset ring-[var(--border)]">
            <div className="text-muted">Our email</div>
            <b className="block break-words">{r.replyTo.subject}</b>
            {r.replyTo.preview && <p className="mt-0.5 break-words text-muted">{r.replyTo.preview}</p>}
            {onReadEmail && <button onClick={onReadEmail} className="mt-1 font-semibold text-accent">Read the whole email ›</button>}
          </div>
        )}

        {isReview ? (
          <button onClick={onOpenReview} disabled={opening}
            className="my-4 flex w-full items-center justify-between gap-3 rounded-[5px] border-2 border-dashed bg-background px-4 py-5 text-left text-[16px] font-semibold text-accent hover:bg-accent-soft/40 disabled:opacity-60">
            <span>{opening ? "Opening…" : `Look over the ${REVIEW_NOUN[review ?? ""] ?? "review"}`}</span><span aria-hidden>›</span>
          </button>
        ) : r.kind === "upload" ? (
          <div className="my-4">
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-[5px] border-2 border-dashed bg-background px-4 py-6 text-center text-[16px] hover:bg-accent-soft/40 disabled:opacity-60">
              <b className="text-accent">{uploading ? "Adding…" : files.length ? "Add more" : "Add your photos or files"}</b>
              <span className="text-muted">Tap to choose them, or drop them here</span>
            </button>
            {picker}
            {fileList}
            <textarea value={body} onChange={(e) => onBody(e.target.value)} rows={2} placeholder="Add a note (optional)"
              className="mt-2 w-full resize-none rounded-[5px] border bg-surface px-3 py-2.5 text-[16px] outline-none focus:border-accent" />
          </div>
        ) : (
          <div className="my-4">
            <textarea value={body} onChange={(e) => onBody(e.target.value)} rows={4} placeholder="Write your answer here"
              className="w-full resize-none rounded-[5px] border bg-surface px-3 py-2.5 text-[16px] outline-none focus:border-accent" />
            {picker}
            {fileList}
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="mt-1 text-[16px] font-semibold text-accent disabled:opacity-60">
              {uploading ? "Adding…" : "📎 Add a file"}
            </button>
          </div>
        )}

        {isReview ? (
          <button onClick={onApprove ?? onOpenReview} disabled={opening || approving} className={dark}>{approving ? "Approving…" : "Approve"}</button>
        ) : (
          <button onClick={onAnswer} disabled={!canSend} className={dark}>
            {sending ? "Sending…" : r.kind === "upload" ? "Send it" : "Answer"}
          </button>
        )}

        {isReview && (changesOpen ? (
          <div className="mt-4 border-t pt-4">
            <label className="block text-[16px] font-semibold" htmlFor={`changes-${r.key}`}>What should we change?</label>
            <textarea id={`changes-${r.key}`} autoFocus value={body} onChange={(e) => onBody(e.target.value)} rows={3}
              className="mt-1.5 w-full resize-none rounded-[5px] border bg-surface px-3 py-2.5 text-[16px] outline-none focus:border-accent" />
            {picker}
            {fileList}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button onClick={onAnswer} disabled={!canSend} className="h-11 rounded-[5px] px-5 ring-2 ring-inset ring-accent text-[16px] font-bold text-accent disabled:opacity-40">
                {sending ? "Sending…" : "Send changes"}
              </button>
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="text-[16px] font-semibold text-accent disabled:opacity-60">{uploading ? "Adding…" : "📎 Add a file"}</button>
            </div>
          </div>
        ) : (
          <button onClick={onAskChanges} className="mt-3 block w-full py-1 text-center text-[16px] font-semibold text-accent">Ask for changes</button>
        ))}
        {error && <div className="mt-2 text-[16px] text-danger">{error}</div>}
      </div>
      {expected && <div className="mt-3 rounded-[5px] bg-accent-soft/60 px-4 py-3 text-[16px]">{expected}</div>}
    </div>
  );
}

/** Everything we need from them, grouped as on our side, each row opening it. */
export function RequestList({ queue, today, listName, onOpen }: {
  queue: PortalRequest[];
  today: string;
  listName: (id: string | null) => string | null;
  onOpen: (r: PortalRequest) => void;
}) {
  const head = { overdue: "bg-danger-soft text-danger", today: "bg-highlight-soft text-highlight", week: "bg-background text-foreground", later: "bg-background text-foreground" } as const;
  return (
    <div className="grid gap-3">
      {groupedQueue(queue, today).map((g) => (
        <section key={g.group} className="overflow-hidden rounded-[5px] border bg-surface shadow-[var(--shadow-sm)]">
          <h3 className={`flex items-center gap-2 border-b px-4 py-2.5 text-[16px] font-bold ${head[g.group]}`}>
            {g.label} <span className="font-semibold text-muted">{g.items.length}</span>
          </h3>
          {g.items.map((r, i) => {
            const d = rowDate(r.needBy, today);
            const list = listName(r.listId);
            return (
              <button key={r.key} onClick={() => onOpen(r)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 text-left hover:bg-background ${i ? "border-t" : ""}`}>
                <span className="min-w-0">
                  <b className="block break-words text-[17px] font-semibold">{r.ask}</b>
                  <span className="block text-[16px] text-muted [overflow-wrap:anywhere]">{[r.taskTitle.trim(), list].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={`whitespace-nowrap text-[16px] ${d ? `${TONE[d.tone]} ${d.tone === "plain" ? "" : "font-bold"}` : "text-muted"}`}>{d?.text ?? ""} <span aria-hidden className="text-muted">›</span></span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
