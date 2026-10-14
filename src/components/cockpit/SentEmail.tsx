"use client";

// A sent email kept on its step's Client work (Derek, 2026-10-12: "keep the
// client box and just show sent, so it doesn't get lost and we can click to
// review"). It says whether the client has written back since; the whole box
// opens the email as it went out.
import { useId, useState, type ReactNode } from "react";
import { clientEmailText, looksLikeHtml, timeAgo, type Attachment, type Message, type ReceivedEmail } from "@/lib/data";
import { isPicture } from "@/lib/pictures";
import { I } from "./ui";
import { reviewTone } from "@/lib/reviewTone";
import { safeMessageHtml } from "@/lib/safeHtml";
import { recipientName } from "@/lib/emailHeader";

const CHANNEL_WORD: Partial<Record<Message["channel"], string>> = { email: "email", sms: "text", chat: "the portal" };

/** The client's first message on this task after the email went out. */
export function replyTo(sent: Message, messages: Message[] | null | undefined): Message | null {
  return (messages ?? [])
    .filter((m) => m.direction === "inbound" && m.at > sent.at && (m.taskId === sent.taskId
      || (!!sent.gmailThreadId && m.gmailThreadId === sent.gmailThreadId)
      || (!!sent.ghlConversationId && m.ghlConversationId === sent.ghlConversationId)))
    .sort((a, b) => a.at.localeCompare(b.at))[0] ?? null;
}

/** An email read in place, as it goes or went out (Derek, 2026-10-14: Show
 *  on a step's draft and sent emails): who it is to, its subject, its body
 *  (sanitised, as the Conversation shows emails) and its files by name. Read
 *  only; the email window is where it changes. */
export function EmailPreview({ id, toName, toEmail, subject, body, attachments, filesView }: {
  id?: string;
  /** Its files drawn by the caller (pictures as themselves); else by name. */
  filesView?: ReactNode;
  toName?: string | null;
  toEmail?: string | null;
  subject: string;
  body: string;
  attachments?: { id: string; name: string }[];
}) {
  const name = recipientName(toName);
  const row = "flex min-w-0 gap-3 border-b px-3 py-2";
  const label = "w-16 shrink-0 font-semibold text-muted";
  return (
    <div id={id} className="overflow-hidden rounded-[5px] border bg-surface text-[16px]">
      <div className={`${row} items-start`}>
        <span className={label}>To</span>
        {toEmail || name ? (
          <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
            {name && <span className="font-semibold [overflow-wrap:anywhere]">{name}</span>}
            {toEmail && <span className={`[overflow-wrap:anywhere] ${name ? "text-muted" : ""}`}>{toEmail}</span>}
          </span>
        ) : <span className="min-w-0 flex-1 text-muted">Nobody yet</span>}
      </div>
      <div className={row}>
        <span className={label}>Subject</span>
        <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{subject.trim() || "(no subject)"}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-3 py-2.5 [overflow-wrap:anywhere]">
        {!body.trim() ? <span className="text-muted">(nothing written yet)</span>
          : looksLikeHtml(body)
            // Sanitised: an email body may hold whatever a stranger sent.
            ? <div className="rte-content" dangerouslySetInnerHTML={{ __html: safeMessageHtml(body) }} />
            : <div className="whitespace-pre-wrap leading-relaxed">{body.trim()}</div>}
      </div>
      {filesView ? (
        <div className={`${row} items-start border-b-0 border-t`}>
          <span className={label}>Files</span>
          <div className="min-w-0 flex-1">{filesView}</div>
        </div>
      ) : attachments && attachments.length > 0 && (
        <div className={`${row} items-start border-b-0 border-t`}>
          <span className={label}>Files</span>
          <span className="flex min-w-0 flex-1 flex-col">
            {attachments.map((a) => <span key={a.id} className="[overflow-wrap:anywhere]">{a.name}</span>)}
          </span>
        </div>
      )}
    </div>
  );
}

/** Show or Hide, the small text link that opens an email in place. */
export function ShowLink({ open, controls, onToggle }: { open: boolean; controls: string; onToggle: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle(); }} onKeyDown={(e) => e.stopPropagation()} aria-expanded={open} aria-controls={controls}
      title={open ? "Hide the email" : "Read the email here"}
      className="shrink-0 font-semibold text-accent underline underline-offset-4 hover:opacity-80">{open ? "Hide" : "Show"}</button>
  );
}

export function SentEmailBox({ message, messages, firstName, toName, toEmail, onRemove, files }: {
  message: Message;
  /** Its files drawn by the caller (EmailFiles), in place of their names. */
  files?: ReactNode;
  messages?: Message[] | null;
  firstName: string;
  /** Who it went to when the message does not say (the client's contact). */
  toName?: string | null;
  toEmail?: string | null;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const reply = replyTo(message, messages);
  const tone = reviewTone(reply ? "approved" : "with_client");
  const toggle = () => setOpen((o) => !o);
  // Who it went to, from the message itself when it says (an address; the
  // GoHighLevel pull can store a phone there), else the client's contact.
  const peer = message.peerAddress?.includes("@") ? message.peerAddress : null;
  return (
    <div className="rounded-[5px] border" style={{ background: tone.chip, borderColor: tone.dot }}>
      <div className="flex min-w-0 items-center gap-3 px-3 py-2">
        <span aria-hidden className="text-[18px]">✉️</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold">{message.subject?.trim() || "Email"}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-[16px] text-muted">
            <span>Sent {timeAgo(message.at)}</span>
            <span aria-hidden>·</span>
            {reply
              ? <span className="font-semibold" style={{ color: tone.text }}>{firstName} replied by {CHANNEL_WORD[reply.channel] ?? reply.channel} {timeAgo(reply.at)}</span>
              : <span>No reply yet</span>}
            <span aria-hidden>·</span>
            <ShowLink open={open} controls={previewId} onToggle={toggle} />
          </span>
        </span>
        {onRemove && (
          <button onClick={onRemove} title="Take off this step (it stays in the conversation)" aria-label="Take this email off the step"
            className="shrink-0 rounded px-1 text-muted hover:text-danger">×</button>
        )}
      </div>
      {open && (
        <div className="border-t bg-surface p-2">
          <EmailPreview id={previewId} toName={peer ? message.peerName : toName} toEmail={peer ?? toEmail}
            subject={message.subject ?? ""} body={message.body} attachments={message.attachments} filesView={files} />
        </div>
      )}
    </div>
  );
}

/** The client's email a "Reply to …" step answers (Derek, 2026-10-12): click
 *  to read it, Reply to start the answer on this step. */
export function ReceivedEmailBox({ email, answered, onReply, files, light = false, approve }: {
  email: ReceivedEmail;
  /** Reply as a light button (the task page's one dark button is Done). */
  light?: boolean;
  answered: boolean;
  onReply?: () => void;
  /** The files that came with it, always in view (Derek, 2026-10-13). */
  files?: ReactNode;
  /** It reads as the client approving the review out with them: one tap
   *  marks that version approved (Derek, 2026-10-14). */
  approve?: { label: string; onClick: () => void };
}) {
  const [open, setOpen] = useState(false);
  const tone = reviewTone(answered ? "approved" : "with_client");
  const toggle = () => setOpen((o) => !o);
  return (
    <div className="rounded-[5px] border" style={{ background: tone.chip, borderColor: tone.dot }}>
      <div role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter") toggle(); }} aria-expanded={open}
        className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-2">
        <span aria-hidden className="text-[18px]">📨</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold">{email.subject || "Email"}</span>
          <span className="block truncate text-[16px] text-muted">From {email.from} · {timeAgo(email.at)}{answered ? " · answered" : ""}</span>
        </span>
        <span aria-hidden className="shrink-0 text-[16px] text-muted">{open ? "Hide" : "Read"}</span>
        {approve && (
          <button onClick={(e) => { e.stopPropagation(); approve.onClick(); }}
            className="shrink-0 rounded-[5px] border bg-surface px-3 py-1.5 text-[16px] font-semibold text-success hover:bg-background">✓ {approve.label}</button>
        )}
        {onReply && !answered && (
          <button onClick={(e) => { e.stopPropagation(); onReply(); }}
            className={`shrink-0 rounded-[5px] px-3 py-1.5 text-[16px] font-semibold ${light ? "border bg-surface text-accent hover:bg-background" : "bg-accent text-white hover:opacity-90"}`}>Reply</button>
        )}
      </div>
      {open && (
        <div className="max-h-[360px] overflow-y-auto whitespace-pre-wrap border-t bg-surface px-3 py-2.5 text-[16px] leading-relaxed [overflow-wrap:anywhere]">
          {clientEmailText(email.body, email.from) || email.body || "(no text)"}
        </div>
      )}
      {files && <div className="border-t bg-surface px-3 py-2">{files}</div>}
    </div>
  );
}

/** An email's files (Derek, 2026-10-14): a picture as a thumbnail with its
 *  name under it, a click opening the full size viewer (Download, Close and
 *  arrows there); anything else a chip with its name and size. */
export function EmailFiles({ files, urls, onOpenPicture, onOpenFile }: {
  files: Attachment[];
  /** Each stored file's viewable address, by its path. */
  urls: Record<string, string>;
  onOpenPicture: (a: Attachment) => void;
  onOpenFile: (a: Attachment) => void;
}) {
  const pics = files.filter((a) => isPicture(a) && !!a.path && !!urls[a.path]);
  const rest = files.filter((a) => !pics.includes(a));
  return (
    <div className="flex flex-col gap-2">
      {pics.length > 0 && (
        <div className="flex flex-wrap items-start gap-3">
          {pics.map((a) => (
            <button key={a.id} onClick={(e) => { e.stopPropagation(); onOpenPicture(a); }} title={`View ${a.name}`} aria-label={`View ${a.name}`}
              className="group flex max-w-[240px] flex-col items-start gap-1 text-left">
              <span className="block overflow-hidden rounded-[5px] border bg-background group-hover:border-accent">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urls[a.path!]} alt={a.name} className="block h-auto max-h-[160px] w-auto max-w-full object-contain" />
              </span>
              <span className="block w-full truncate text-[16px] font-medium text-accent">{a.name}</span>
            </button>
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          {rest.map((a) => (
            <button key={a.id} onClick={(e) => { e.stopPropagation(); onOpenFile(a); }} title={`Open ${a.name}`}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[5px] border bg-background px-2.5 py-1 text-left text-[16px] hover:border-accent">
              <I.clip className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 truncate font-medium text-accent">{a.name}</span>
              {a.size && <span className="shrink-0 text-muted">{a.size}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
