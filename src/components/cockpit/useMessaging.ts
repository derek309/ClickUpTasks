"use client";

// Client messages from the team's side: sending (chat, email through Gmail or
// GoHighLevel, text), editing, deleting, marking read, sending later, pulling
// in replies GoHighLevel's webhook missed, and loading a conversation's older
// messages when it opens. Lifted out of Cockpit.tsx unchanged (audit
// 2026-09-29, 3.4). The message list itself stays in Cockpit, which the live
// updates and the start load also write.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { authedFetch } from "@/lib/supabase";
import { insertMessage, deleteMessageDb, markTaskChannelReadDb, signedUrlForFile, rowToScheduledMessage, fetchMessagesFor } from "@/lib/db";
import { mergeFetched } from "@/lib/localTaskWrites";
import type { Attachment, Client, Contact, Message, MessageChannel, ScheduledMessage } from "@/lib/data";
import { newId } from "./ui";

export function useMessaging({ meId, messages, setMessages, loading, openTaskId, conversationContactId, contactForClient, clientById, pushToast, onAnswered }: {
  meId: string;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  /** True until the first load lands; older messages wait for it, since it replaces the list. */
  loading: boolean;
  openTaskId: string | null;
  /** The contact whose Journal or email composer is open, if any. */
  conversationContactId: string | null;
  contactForClient: (clientId: string) => Contact | null;
  clientById: (id: string) => Client | null;
  pushToast: (text: string) => void;
  /** An email or text went out from this task. Cockpit closes a "Reply to X"
   *  task with it, the same as answering from Gmail does on the server. */
  onAnswered?: (taskId: string) => void;
}) {
  // GoHighLevel messages (email now, sms later) -------------------------
  // Same target-resolution shape as ghlTargetFor above, but keyed directly off
  // a Contact rather than a Task, since a message belongs to the person, not
  // any one piece of work.
  const ghlTargetForContact = (contact: Contact): { locationId: string; ghlContactId: string } | null => {
    if (!contact.ghlContactId) return null;
    const sub = clientById(contact.clientId);
    if (!sub?.ghlLocationId) return null;
    return { locationId: sub.ghlLocationId, ghlContactId: contact.ghlContactId };
  };
  const [sendingMessage, setSendingMessage] = useState(false);
  // Sends via GHL's Conversations API (so it goes out from the sub-account's
  // own connected email/number) and only writes the local `messages` row
  // after a confirmed success — same pattern as pushToGhl. This is the
  // "outbound" half of the Chat tab's Messages view; the webhook (see
  // src/app/api/ghl/webhook/route.ts) covers inbound replies, so together
  // the two capture a full two-way conversation with no gap and no polling.
  const sendMessage = async (clientId: string, channel: MessageChannel, subject: string, body: string, attachments: Attachment[] = [], cc: string[] = [], bcc: string[] = [], taskId: string | null = null, fromEmail?: string, replyToMessageId?: string | null) => {
    if (!body.trim()) return;
    const contact = contactForClient(clientId);
    if (!contact) { pushToast("This client isn't linked to a GHL contact yet."); return; }
    // Chat needs neither GHL nor Gmail — it's just a `messages` row the
    // client sees on their own /waiting/[token] page (picked up by the
    // page's own polling), not something delivered through either provider.
    // No per-message email either: only a debounced "you have a new
    // message" nudge, gated server-side by a per-CLIENT cooldown (not
    // per-task — replying across several of the same client's tasks in one
    // pass must still add up to one email, see notify-client/route.ts).
    if (channel === "chat") {
      setSendingMessage(true);
      try {
        const m: Message = {
          id: newId("msg_"), contactId: contact.id, clientId, taskId, channel, direction: "outbound",
          subject: null, body, ghlMessageId: null, createdBy: meId, at: new Date().toISOString(), read: true,
          attachments, cc: [], bcc: [],
        };
        setMessages((ms) => [...ms, m]);
        insertMessage(m);
        if (taskId) {
          authedFetch("/api/messages/notify-client", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientId, taskId }),
          }).catch(() => {});
        }
      } finally {
        setSendingMessage(false);
      }
      return;
    }
    // A reply goes to whoever wrote the email being answered, not the client's
    // main contact (answering Russell on Matthew's task went to Matthew,
    // Justin, 2026-10-07). The server checks the same thing.
    const answering = channel === "email" && replyToMessageId ? messages.find((m) => m.id === replyToMessageId) : null;
    const peerEmail = (answering?.peerAddress ?? "").trim().toLowerCase();
    const replyPeer = answering && answering.channel === "email" && answering.clientId === clientId && peerEmail.includes("@") && !peerEmail.endsWith("@clickuplocal.com") ? peerEmail : null;
    const toEmail = replyPeer ?? contact.email;
    const target = ghlTargetForContact(contact);
    if (!target) { pushToast("No GoHighLevel connection for this client's sub-account."); return; }
    // Cc/Bcc are an email-only concept — never carry them onto an SMS send.
    const emailCc = channel === "email" ? cc : [];
    const emailBcc = channel === "email" ? bcc : [];
    setSendingMessage(true);
    try {
      // Per-teammate "from": route attachment-free emails through Google
      // Workspace (Gmail API) so they come from the sender's own address, not
      // GHL's default. SMS and attachment-bearing emails (v1 Gmail path has no
      // attachments yet) stay on GHL. A 501 from the Google route (not
      // configured, or the caller isn't a domain sender) falls through to GHL,
      // so nothing breaks before setup.
      if (channel === "email" && !!toEmail) {
        const gres = await authedFetch("/api/google/send", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, toEmail, subject, body, isHtml: channel === "email", cc: emailCc, bcc: emailBcc, fromEmail, replyToMessageId, attachments: attachments.filter((a) => a.path).map((a) => ({ path: a.path, name: a.name })) }),
        });
        if (gres.status !== 501) {
          const gj = await gres.json().catch(() => ({}));
          if (!gres.ok || gj.error) { pushToast(gj.error || "Failed to send email."); return; }
          // The send succeeded but something did not go with it. Said out
          // loud, because an email that quietly leaves the screenshot behind
          // is worse than one that fails.
          if (Array.isArray(gj.skippedAttachments) && gj.skippedAttachments.length) {
            pushToast(`Sent, but ${gj.skippedAttachments.length} attachment${gj.skippedAttachments.length === 1 ? "" : "s"} could not be included: ${gj.skippedAttachments.join(", ")}`);
          }
          const gm: Message = {
            id: newId("msg_"), contactId: contact.id, clientId, taskId, channel, direction: "outbound",
            subject: subject.trim() ? subject.trim() : null, body,
            ghlMessageId: null, gmailMessageId: gj.gmailMessageId ?? null, gmailThreadId: gj.gmailThreadId ?? null, rfc822MessageId: gj.rfc822MessageId ?? null, createdBy: meId, at: new Date().toISOString(), read: true,
            attachments, cc: emailCc, bcc: emailBcc, peerAddress: (gj.to as string | undefined) ?? toEmail ?? null,
          };
          setMessages((ms) => [...ms, gm]);
          insertMessage(gm);
          if (taskId) onAnswered?.(taskId);
          return;
        }
        // 501 → fall through to the GHL path below.
      }
      // GoHighLevel only reaches the client's own contact: never send them a
      // reply that was meant for someone else on the thread.
      if (replyPeer && replyPeer !== (contact.email ?? "").trim().toLowerCase()) {
        pushToast(`This reply is to ${replyPeer}, and only an email from your own ClickUpLocal address can reach them.`);
        return;
      }
      // GHL fetches attachments itself from a URL rather than accepting an
      // upload — an hour is ample time for that fetch, without leaving the
      // private bucket's contents reachable indefinitely.
      const attachmentUrls = (await Promise.all(attachments.filter((a) => a.path).map((a) => signedUrlForFile(a.path!, 60 * 60)))).filter((u): u is string => !!u);
      const res = await authedFetch("/api/ghl/message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, locationId: target.locationId, ghlContactId: target.ghlContactId, channel, subject: channel === "email" ? subject : undefined, body, isHtml: channel === "email", attachments: attachmentUrls, cc: emailCc, bcc: emailBcc, replyToMessageId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to send message."); return; }
      const m: Message = {
        id: newId("msg_"), contactId: contact.id, clientId, taskId, channel, direction: "outbound",
        subject: channel === "email" && subject.trim() ? subject.trim() : null, body,
        ghlMessageId: j.ghlMessageId ?? null, ghlConversationId: j.ghlConversationId ?? null, createdBy: meId, at: new Date().toISOString(), read: true,
        attachments, cc: emailCc, bcc: emailBcc,
      };
      setMessages((ms) => [...ms, m]);
      insertMessage(m);
      if (taskId) onAnswered?.(taskId);
    } catch {
      pushToast("Failed to send message.");
    } finally {
      setSendingMessage(false);
    }
  };

  // Admin-only correction for a message that already sent wrong (see
  // supabase/message-delete-policy.sql + api/messages/edit for why edit goes
  // through a server route instead of RLS). Neither of these unsends a real
  // email/text already in the client's inbox — they only change what
  // ClickUpTasks and the client's public waiting-page thread show from here on.
  const deleteMessage = (id: string) => {
    setMessages((ms) => ms.filter((m) => m.id !== id));
    deleteMessageDb(id);
  };
  // Clears the unread dot on one TaskDrawer channel tab (Chat/Email/SMS) the
  // moment it's opened — narrower than onOpenMessages above, which clears
  // every channel for the whole contact when the client-level Journal opens.
  const markTaskChannelRead = (taskId: string, channel: MessageChannel) => {
    setMessages((ms) => ms.map((m) => (m.taskId === taskId && m.channel === channel && !m.read ? { ...m, read: true } : m)));
    markTaskChannelReadDb(taskId, channel);
  };
  const editMessage = async (id: string, body: string, subject?: string | null) => {
    const prev = messages;
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, body, ...(subject !== undefined ? { subject } : {}) } : m)));
    try {
      const res = await authedFetch("/api/messages/edit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, body, subject }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { setMessages(prev); pushToast(j.error || "Failed to update message."); }
    } catch {
      setMessages(prev);
      pushToast("Failed to update message.");
    }
  };

  // Scheduled sends (send later) ----------------------------------------
  // Fetched on demand per client (not part of fetchAll's global load — a
  // pending-send queue is small and only matters while its client's
  // Journal/composer is open), fired by the /api/cron/send-scheduled cron.
  const [scheduledMessages, setScheduledMessages] = useState<Record<string, ScheduledMessage[]>>({});
  const loadScheduledMessages = async (clientId: string) => {
    try {
      const res = await authedFetch(`/api/messages/schedule?clientId=${encodeURIComponent(clientId)}`);
      const j = await res.json();
      if (!res.ok) return;
      setScheduledMessages((m) => ({ ...m, [clientId]: (j.scheduled ?? []).map(rowToScheduledMessage).filter((s: ScheduledMessage) => s.status === "pending") }));
    } catch { /* best-effort; the composer just shows nothing pending */ }
  };
  const scheduleMessage = async (clientId: string, channel: MessageChannel, subject: string, body: string, scheduledAt: string, attachments: Attachment[] = [], cc: string[] = [], bcc: string[] = [], taskId: string | null = null, fromEmail?: string, replyToMessageId?: string | null) => {
    if (!body.trim()) return;
    try {
      const res = await authedFetch("/api/messages/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, taskId, channel, subject, body, cc, bcc, fromEmail, replyToMessageId, scheduledAt, attachments: attachments.filter((a) => a.path).map((a) => ({ path: a.path, name: a.name })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to schedule message."); return; }
      pushToast(`🕐 Scheduled for ${new Date(scheduledAt).toLocaleString()}`);
      loadScheduledMessages(clientId);
    } catch {
      pushToast("Failed to schedule message.");
    }
  };
  const cancelScheduledMessage = async (id: string, clientId: string) => {
    try {
      const res = await authedFetch("/api/messages/schedule", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to cancel."); return; }
      setScheduledMessages((m) => ({ ...m, [clientId]: (m[clientId] ?? []).filter((s) => s.id !== id) }));
      pushToast("Scheduled send canceled");
    } catch {
      pushToast("Failed to cancel.");
    }
  };

  // Backfills any GHL messages our webhook never captured — messages is
  // realtime-subscribed, so genuinely new rows this inserts show up on their
  // own; no local state merge needed here.
  const [refreshingMessages, setRefreshingMessages] = useState(false);
  // opts.silent: used by the auto-refresh-on-open-Interaction-task effect
  // below — still surfaces a toast when it actually finds something (that's
  // the whole point — "already handled elsewhere"), just skips the
  // no-op/error noise on every task open.
  const refreshMessages = async (clientId: string, contact: Contact, opts?: { silent?: boolean }) => {
    const target = ghlTargetForContact(contact);
    if (!target) { if (!opts?.silent) pushToast("No GoHighLevel connection for this client's sub-account."); return; }
    setRefreshingMessages(true);
    try {
      const res = await authedFetch("/api/ghl/refresh-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, contactId: contact.id, locationId: target.locationId, ghlContactId: target.ghlContactId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { if (!opts?.silent) pushToast(j.error || "Failed to refresh messages."); return; }
      if (j.inserted > 0) pushToast(`Found ${j.inserted} new message${j.inserted === 1 ? "" : "s"} — may already be handled.`);
      else if (!opts?.silent) pushToast("No new messages.");
    } catch {
      if (!opts?.silent) pushToast("Failed to refresh messages.");
    } finally {
      setRefreshingMessages(false);
    }
  };
  // The start load holds the last 60 days of messages (db.ts fetchAll). A
  // conversation's older ones load when it opens: the task drawer, a client's
  // Journal, the client email composer. Once per conversation per session.
  const loadedConversations = useRef(new Set<string>());
  // Not before the first load lands: it replaces the whole list.
  useEffect(() => {
    if (loading) return;
    const scopes: ({ taskId: string } | { contactId: string })[] = [];
    if (openTaskId) scopes.push({ taskId: openTaskId });
    if (conversationContactId) scopes.push({ contactId: conversationContactId });
    for (const scope of scopes) {
      const key = "taskId" in scope ? `t:${scope.taskId}` : `c:${scope.contactId}`;
      if (loadedConversations.current.has(key)) continue;
      loadedConversations.current.add(key);
      void fetchMessagesFor(scope).then((older) => {
        if (!older.length) return;
        setMessages((prev) => {
          const merged = mergeFetched(prev, older);
          return merged.length === prev.length ? merged : merged.sort((a, b) => a.at.localeCompare(b.at));
        });
      });
    }
  }, [loading, openTaskId, conversationContactId, setMessages]);

  /** After the whole list is reloaded, every conversation's older messages load again. */
  const resetConversations = () => loadedConversations.current.clear();

  return {
    sendingMessage, sendMessage, deleteMessage, markTaskChannelRead, editMessage,
    scheduledMessages, loadScheduledMessages, scheduleMessage, cancelScheduledMessage,
    refreshingMessages, refreshMessages, resetConversations,
  };
}
