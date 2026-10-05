"use client";

// What the team keeps about a client beyond tasks: its links, its notes, and
// the team's direct messages to each other. Lifted out of Cockpit.tsx
// unchanged (audit 2026-09-29, 3.4).

import * as React from "react";
import { type ConfirmSpec } from "./modals";
import { newId } from "./ui";
import { dmConversationId, mentionsUser, type Attachment, type Client, type ClientLink, type ClientNote, type DmMessage, type Me, type NoteType, type NotificationKind, type Project, users } from "@/lib/data";
import { deleteClientLinkDb, deleteClientNoteDb, deleteDmMessageDb, insertDmMessage, updateDmMessageDb, upsertClientLink, upsertClientNote } from "@/lib/db";
import { DM_LINK_PREFIX } from "@/lib/navState";

export type UseClientRecordsDeps = {
  setClientLinks: React.Dispatch<React.SetStateAction<ClientLink[]>>;
  clientLinks: ClientLink[];
  setLinkModal: React.Dispatch<React.SetStateAction<{ initial?: ClientLink; } | null>>;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmSpec | null>>;
  me: Me;
  dmMessages: DmMessage[];
  setDmMessages: React.Dispatch<React.SetStateAction<DmMessage[]>>;
  notify: (recipientId: string, text: string, taskId: string | null, extra?: { clientId?: string | null; projectId?: string | null; kind?: NotificationKind; skipEmail?: boolean; link?: string; }) => void;
  setClientNotes: React.Dispatch<React.SetStateAction<ClientNote[]>>;
  projectById: (id: string) => Project | null;
  clientById: (id: string) => Client | null;
};

export function useClientRecords({ setClientLinks, clientLinks, setLinkModal, setConfirmDialog, me, setDmMessages, notify, setClientNotes, projectById, clientById }: UseClientRecordsDeps) {
  // --- client links -----------------------------------------------------
  const saveLink = (clientId: string, initial: ClientLink | undefined, v: { label: string; url: string; groupLabel: string; color: string }) => {
    if (initial) {
      const updated: ClientLink = { ...initial, ...v };
      setClientLinks((ls) => ls.map((l) => (l.id === initial.id ? updated : l)));
      upsertClientLink(updated);
    } else {
      const link: ClientLink = { id: newId("cl_"), clientId, position: clientLinks.filter((l) => l.clientId === clientId).length, ...v };
      setClientLinks((ls) => [...ls, link]);
      upsertClientLink(link);
    }
    setLinkModal(null);
  };
  const deleteLink = (link: ClientLink) => setConfirmDialog({
    title: `Delete "${link.label}"?`, message: "This can't be undone.", confirmLabel: "Delete",
    onConfirm: () => { setConfirmDialog(null); setClientLinks((ls) => ls.filter((l) => l.id !== link.id)); deleteClientLinkDb(link.id); },
  });
  const reorderLinks = (clientId: string, orderedIds: string[]) => {
    const reordered = orderedIds.map((id, i) => { const l = clientLinks.find((x) => x.id === id)!; return { ...l, position: i }; });
    setClientLinks((ls) => [...ls.filter((l) => l.clientId !== clientId), ...reordered]);
    reordered.forEach((l) => upsertClientLink(l));
  };

  // --- direct messages -----------------------------------------------------
  // Private 1:1 chat between two teammates — see supabase/dm-chat.sql. A DM
  // has exactly one addressee by construction, so there's no @mention scan:
  // every send notifies the recipient directly.
  const sendDmMessage = (otherUserId: string, body: string, attachments?: Attachment[], replyToId?: string | null) => {
    if (!body.trim() && !attachments?.length) return;
    const cid = dmConversationId(me.id, otherUserId);
    const m: DmMessage = { id: newId("dm_"), conversationId: cid, authorId: me.id, recipientId: otherUserId, body: body.trim(), at: new Date().toISOString(), replyToId: replyToId ?? null, attachments: attachments ?? [] };
    setDmMessages((ms) => [...ms, m]);
    insertDmMessage(m);
    // Straight to the thread. Without a link the email fell back to the app
    // root, so "Justin sent you a message" landed you on your own dashboard
    // with no way to find the message it was about (Derek: "it doesn't link
    // to where the message is"). The recipient is the one reading the mail,
    // so the thread they need is the one with ME in it.
    notify(otherUserId, `${me.name} sent you a message`, null, {
      // No email when it is sent: the Inbox has it. One that waits 2 hours
      // unanswered gets a reminder email instead (api/cron/missed-messages).
      kind: "dm", skipEmail: true, link: `${DM_LINK_PREFIX}&dm=${encodeURIComponent(me.id)}`,
    });
  };
  const deleteDmMessage = (id: string) => {
    setConfirmDialog({
      title: "Delete this message?",
      message: "It disappears for both of you. This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () => {
        setConfirmDialog(null);
        setDmMessages((ms) => ms.filter((m) => m.id !== id));
        deleteDmMessageDb(id);
      },
    });
  };
  // Both participants (or admin) can pin — matches dm_messages_update's RLS
  // predicate exactly (the same people who can already read the thread).
  const pinDmMessage = (id: string, pinned: boolean) => {
    const patch = { pinned, pinnedBy: pinned ? me.id : null, pinnedAt: pinned ? new Date().toISOString() : null };
    setDmMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    updateDmMessageDb(id, patch);
  };

  // --- client notes ------------------------------------------------------
  const addNote = (clientId: string, type: NoteType, body: string, projectId?: string | null, attachments?: Attachment[]) => {
    const note: ClientNote = { id: newId("cn_"), clientId, projectId: projectId ?? null, type, body, authorId: me.id, at: new Date().toISOString(), ...(attachments?.length ? { attachments } : {}) };
    setClientNotes((ns) => [note, ...ns]); // newest-first feed
    upsertClientNote(note);
    // @mentions notify, same as task comments — the one signal that pulls
    // people back into this feed instead of it going stale and unread.
    const where = projectId ? projectById(projectId)?.name : clientById(clientId)?.name;
    users.forEach((u) => {
      if (u.id !== me.id && mentionsUser(body, u.name)) notify(u.id, `${me.name} mentioned you in the ${where ?? "team"} chat`, null, { clientId, projectId, kind: "message" });
    });
  };
  const editNote = (note: ClientNote, body: string) => {
    const updated: ClientNote = { ...note, body };
    setClientNotes((ns) => ns.map((n) => (n.id === note.id ? updated : n)));
    upsertClientNote(updated);
  };
  const deleteNote = (note: ClientNote) => {
    setClientNotes((ns) => ns.filter((n) => n.id !== note.id));
    deleteClientNoteDb(note.id);
  };

  return { addNote, deleteLink, reorderLinks, sendDmMessage, deleteDmMessage, pinDmMessage, editNote, deleteNote, saveLink };
}
