"use client";

// The email staged on a task for a person to check and send: written here, by
// the in-app drafter, or by Claude through the MCP draft_email tool. One line in
// the task (Derek, 2026-09-11: "make the draft emails work the same as the
// document"); Open writes it in the email window (EmailWindow.tsx), which Email
// and Reply on the task open too. Nothing sends on its own.
//
// The draft stays on the task until the email really went out: it retires itself
// once a matching outbound email exists, so a failed send never loses it.
import { useEffect, useState } from "react";
import { STATUS_META, timeAgo, type Attachment, type Contact, type Message, type Task } from "@/lib/data";
import { WorkItemBadge, WorkItemRow } from "./TaskWorkItem";
import { EmailWindow, sentEmailFor, type OutgoingEmail } from "./EmailWindow";

export function DraftEmail({ task, onPatch, toEmail, onSend, onSchedule, onUpload, ccContacts, messages, openNonce, pushToast, onAiDraft, aiNonce }: {
  task: Task;
  onPatch: (patch: Partial<Task>) => void;
  /** The linked contact's address, or null when there is nobody to send to yet. */
  toEmail: string | null;
  /** Missing when this teammate can't message this client. */
  onSend?: (email: OutgoingEmail) => void;
  onSchedule?: (email: OutgoingEmail, whenIso: string) => void;
  onUpload?: (file: File) => Promise<Attachment | null>;
  ccContacts?: Contact[];
  messages?: Message[] | null;
  /** Bumped to open it: the "+ Draft email" chip, Email or Reply on the task, a document sent for review. */
  openNonce: number;
  pushToast: (text: string) => void;
  /** Writes the email with AI from an instruction and the draft's own context. */
  onAiDraft?: (instruction: string, context?: string) => Promise<{ subject?: string; body: string } | null>;
  /** Bumped to write the email with AI as soon as it opens (a document just sent for review). */
  aiNonce?: number;
}) {
  const draft = task.draftEmail ?? null;
  const [full, setFull] = useState(false);
  const [seenNonce, setSeenNonce] = useState(openNonce);
  const [seenAiNonce, setSeenAiNonce] = useState(aiNonce);

  const sentAlready = draft ? sentEmailFor(draft, messages) : null;
  useEffect(() => {
    // Idempotent, so two people with the task open both writing null is harmless.
    if (draft && sentAlready) onPatch({ draftEmail: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, !!draft, sentAlready?.id]);

  if (!draft) return null;
  const open = full || openNonce !== seenNonce;
  const close = () => { setSeenNonce(openNonce); setSeenAiNonce(aiNonce); setFull(false); };

  const count = draft.attachments?.length ?? 0;
  const badge = <WorkItemBadge label="Not sent" chip={STATUS_META.todo.chip} dot={STATUS_META.todo.dot} />;
  const meta = [
    toEmail ? `To ${toEmail}` : "No linked contact to send to",
    count ? `${count} ${count === 1 ? "attachment" : "attachments"}` : null,
    `Edited ${timeAgo(draft.updatedAt ?? draft.createdAt)}`,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <WorkItemRow tone="email" icon="✉️" title={draft.subject.trim() || "Draft email"} badge={badge} meta={meta}
        onOpen={() => setFull(true)} />
      {open && (
        <EmailWindow key={draft.createdAt} draft={draft} heading="Draft email" subheading={task.title} subjectFallback={task.title}
          save={(next) => onPatch({ draftEmail: next })} onDiscard={() => onPatch({ draftEmail: null })} onClose={close}
          onSend={onSend} onSchedule={onSchedule} toEmail={toEmail} ccContacts={ccContacts} onUpload={onUpload}
          onAiDraft={onAiDraft} writeOnOpen={aiNonce !== seenAiNonce} taskItems={task.attachments} pushToast={pushToast} />
      )}
    </>
  );
}
