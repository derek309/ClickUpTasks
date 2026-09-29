"use client";

// The AI helpers (a client's summary, a drafted message, a drafted task
// description) and refreshing a contact from GoHighLevel. Lifted out of
// Cockpit.tsx unchanged (audit 2026-09-29, 3.4).

import * as React from "react";
import { type Client, type Contact, type MessageChannel, type Task } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";
import { useState } from "react";

export type UseAiHelpersDeps = {
  setAiSummaryBusyId: React.Dispatch<React.SetStateAction<string | null>>;
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  addNote: (clientId: string, type: import("@/lib/data").NoteType, body: string, projectId?: string | null, attachments?: import("@/lib/data").Attachment[]) => void;
  pushToast: (text: string, action?: { label: string; run: () => void; }, secondaryAction?: { label: string; run: () => void; }) => void;
  openTask: Task | null;
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
};

export function useAiHelpers({ setAiSummaryBusyId, setClients, addNote, pushToast, openTask, setContacts }: UseAiHelpersDeps) {
  const regenerateAiSummary = async (clientId: string) => {
    setAiSummaryBusyId(clientId);
    try {
      const res = await authedFetch("/api/ai/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "AI summary failed.");
      setClients((cs) => cs.map((x) => (x.id === clientId ? { ...x, aiSummary: j.summary, aiSummaryAt: j.generatedAt } : x)));
      // Log it into the Chat journal too, not just the AI tab's single
      // overwritable field — this is what makes the journal an actual
      // history instead of losing every prior summary on regenerate.
      addNote(clientId, "ai_summary", j.summary);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "AI summary failed.");
    } finally {
      setAiSummaryBusyId(null);
    }
  };
  // Drafts a client-facing status update via Gemini — fills the composer's
  // subject/body, never sends. Send is independently gated by
  // canMessageClient regardless of what this returns.
  const [draftingMessage, setDraftingMessage] = useState(false);
  const draftMessage = async (clientId: string, channel: MessageChannel, prompt?: string, projectId?: string | null, context?: string): Promise<{ subject?: string; body: string } | null> => {
    setDraftingMessage(true);
    try {
      const res = await authedFetch("/api/ai/draft-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, channel, prompt, projectId: projectId ?? undefined, context }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to draft message."); return null; }
      return { subject: j.subject, body: j.body };
    } catch {
      pushToast("Failed to draft message.");
      return null;
    } finally {
      setDraftingMessage(false);
    }
  };
  // Same pattern for the task description — Gemini drafts, never saves.
  const [draftingDescription, setDraftingDescription] = useState(false);
  const draftDescription = async (title: string, description: string, prompt?: string): Promise<string | null> => {
    setDraftingDescription(true);
    try {
      const res = await authedFetch("/api/ai/draft-description", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: openTask?.clientId, title, description, prompt }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to draft description."); return null; }
      return j.body ?? null;
    } catch {
      pushToast("Failed to draft description.");
      return null;
    } finally {
      setDraftingDescription(false);
    }
  };
  // Re-pulls one contact's info from GHL on demand — the bulk sync re-syncs
  // a whole sub-account (~30 sequential API calls for a big location), way
  // more than needed to check if one person's phone number changed.
  const [refreshingContact, setRefreshingContact] = useState(false);
  const refreshContact = async (contact: Contact) => {
    if (!contact.ghlContactId) { pushToast("This contact isn't linked to GoHighLevel."); return; }
    setRefreshingContact(true);
    try {
      // No locationId needed — the route tries every connected sub-account's
      // token itself, since a client's own ghlLocationId field is
      // unreliable for this (often empty, or repurposed as a company-name
      // label — see the route's comment). This is read-only, so trying
      // several tokens is safe.
      const res = await authedFetch("/api/ghl/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId: contact.id, ghlContactId: contact.ghlContactId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { pushToast(j.error || "Failed to refresh contact."); return; }
      setContacts((cs) => cs.map((c) => (c.id === contact.id ? j.contact : c)));
      pushToast("Contact info refreshed.");
    } catch {
      pushToast("Failed to refresh contact.");
    } finally {
      setRefreshingContact(false);
    }
  };
  return { draftMessage, draftingMessage, refreshContact, refreshingContact, regenerateAiSummary, draftDescription, draftingDescription };
}
