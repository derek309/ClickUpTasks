"use client";

// An email to a client that isn't about one task: the client Journal's Email and
// Reply, and Remind client. Written in the same window as a task's draft email
// (EmailWindow.tsx); the draft is kept on the client, one at a time, until it is
// sent or discarded (supabase/client-email-drafts.sql). Derek chose this
// 2026-09-11 over drafts that only live while the window is open.
import { useEffect, useState } from "react";
import { htmlToText, type Attachment, type Contact, type EmailDraft, type Message, type ScheduledMessage } from "@/lib/data";
import { deleteClientEmailDraft, fetchClientEmailDraft, saveClientEmailDraft } from "@/lib/db";
import { EmailWindow, sentEmailFor, type OutgoingEmail } from "./EmailWindow";

/** What opened the window. Only a clientId opens the saved draft (or a blank one);
 *  a subject or body (Reply, Remind client) starts a new email. */
export type ClientEmailStart = {
  clientId: string;
  nonce: number;
  subject?: string;
  body?: string;
  link?: { url: string; label: string } | null;
  aiContext?: string;
  /** messages.id a Reply answers. */
  replyTo?: string | null;
};

export function ClientEmail({ start, clientName, meId, toEmail, messages, onClose, onSend, onSchedule, ccContacts, onUpload, onAiDraft, scheduled, onLoadScheduled, onCancelScheduled, pushToast }: {
  start: ClientEmailStart;
  clientName: string;
  meId: string;
  toEmail: string | null;
  /** This client's messages, to spot a saved draft that already went out. */
  messages: Message[] | null;
  onClose: () => void;
  onSend?: (email: OutgoingEmail) => void;
  onSchedule?: (email: OutgoingEmail, whenIso: string) => void;
  ccContacts?: Contact[];
  onUpload?: (file: File) => Promise<Attachment | null>;
  onAiDraft?: (instruction: string, context?: string) => Promise<{ subject?: string; body: string } | null>;
  scheduled?: ScheduledMessage[];
  onLoadScheduled?: () => void;
  onCancelScheduled?: (id: string) => void;
  pushToast: (text: string) => void;
}) {
  const { clientId } = start;
  const [draft, setDraft] = useState<EmailDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchClientEmailDraft(clientId).then((saved) => {
      if (cancelled) return;
      // A saved draft that already went out is cleared rather than reopened.
      if (saved && sentEmailFor(saved, messages)) { void deleteClientEmailDraft(clientId); saved = null; }
      const startsNew = start.subject !== undefined || start.body !== undefined;
      const keepSaved = !!saved && (!startsNew
        || (!!htmlToText(saved.body).trim() && !window.confirm(`You already started an email to ${clientName}. Replace it with this one?`)));
      if (saved && keepSaved) { setDraft(saved); return; }
      const now = new Date().toISOString();
      setDraft({ subject: start.subject ?? "", body: start.body ?? "", link: start.link ?? null, aiContext: start.aiContext, replyTo: start.replyTo ?? null, createdAt: now, updatedAt: now });
    });
    onLoadScheduled?.();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) return null;
  return (
    <EmailWindow key={draft.createdAt} draft={draft} heading="Email" subheading={clientName}
      save={(next) => { setDraft(next); void saveClientEmailDraft(clientId, next, meId); }}
      onDiscard={() => { void deleteClientEmailDraft(clientId); }}
      onClose={onClose} onSend={onSend} onSchedule={onSchedule} toEmail={toEmail}
      ccContacts={ccContacts} onUpload={onUpload} onAiDraft={onAiDraft}
      scheduled={scheduled} onCancelScheduled={onCancelScheduled} pushToast={pushToast} />
  );
}
