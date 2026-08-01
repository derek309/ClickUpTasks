// SERVER-ONLY: files a Granola meeting note into the right client's Journal.
// Shared by the webhook route (real-time) and the manual backfill sync route.
// Matches the "match an external event to a known Contact by email, then
// file it" pattern already used by src/lib/inboundIngest.ts and
// src/app/api/google/poll-replies/route.ts.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { granolaGetNote } from "./granolaClient";
import { resolveOrPromoteTrackedClient } from "./ghlConversationTask";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SYSTEM_AUTHOR_ID = "u_claude";

export type GranolaSyncResult = "created" | "unmatched" | "skipped" | "internal";

// Plain text, not markdown — the Journal feed renders a note's body as-is,
// with no markdown parser, so **bold**/### headers would show as literal
// asterisks/hashes. Prefer summary_text (Granola's own plain-text summary)
// over summary_markdown for exactly that reason.
function noteBody(note: Awaited<ReturnType<typeof granolaGetNote>>): string {
  const title = note.title || note.calendar_event?.event_title || "Meeting";
  const summary = note.summary_text?.trim() || note.summary_markdown?.trim() || "(no summary)";
  const link = note.web_url ? `\n\nView in Granola: ${note.web_url}` : "";
  return `${title}\n\n${summary}${link}`;
}

export async function syncOneGranolaNote(noteId: string): Promise<GranolaSyncResult> {
  const { data: already } = await supabaseAdmin.from("granola_synced_notes").select("granola_note_id").eq("granola_note_id", noteId).maybeSingle();
  if (already) return "skipped";

  const note = await granolaGetNote(noteId);

  // Internal-only teammate addresses never count as "the client" — exclude
  // any attendee email that's actually one of our own profiles.
  const { data: teamProfiles } = await supabaseAdmin.from("profiles").select("email");
  const teamEmails = new Set((teamProfiles ?? []).map((p: any) => (p.email ?? "").toLowerCase()).filter(Boolean));

  const attendeeEmails = new Set<string>();
  for (const a of note.attendees ?? []) { const e = a.email?.trim().toLowerCase(); if (e) attendeeEmails.add(e); }
  for (const i of note.calendar_event?.invitees ?? []) { const e = i.email?.trim().toLowerCase(); if (e) attendeeEmails.add(e); }
  const externalEmails = [...attendeeEmails].filter((e) => !teamEmails.has(e));

  const { data: contacts } = await supabaseAdmin.from("contacts").select("id, name, client_id, email").not("email", "is", null);
  const contactByEmail = new Map<string, any>();
  for (const c of contacts ?? []) {
    const e = (c.email ?? "").trim().toLowerCase();
    if (e && !contactByEmail.has(e)) contactByEmail.set(e, c);
  }
  // No external attendees at all (an internal-only team meeting, or a solo
  // note) — nothing to match or triage. Record it as seen and stop, rather
  // than parking a meeting with no possible client in the triage queue.
  if (externalEmails.length === 0) {
    await supabaseAdmin.from("granola_synced_notes").insert({ granola_note_id: noteId, client_id: null, client_note_id: null });
    return "internal";
  }

  const matchedContact = externalEmails.map((e) => contactByEmail.get(e)).find(Boolean);

  if (!matchedContact) {
    await supabaseAdmin.from("granola_unmatched").insert({
      id: "gu_" + randomUUID(), granola_note_id: noteId,
      title: note.title || note.calendar_event?.event_title || null,
      attendees: externalEmails.map((e) => ({ email: e })),
      summary: note.summary_text || note.summary_markdown || null,
      web_url: note.web_url || null,
      occurred_at: note.calendar_event?.scheduled_start_time || note.created_at,
    });
    await supabaseAdmin.from("granola_synced_notes").insert({ granola_note_id: noteId, client_id: null, client_note_id: null });
    return "unmatched";
  }

  const clientId = await resolveOrPromoteTrackedClient({ id: matchedContact.id, name: matchedContact.name, client_id: matchedContact.client_id });
  const clientNoteId = "cn_" + randomUUID();
  const { error } = await supabaseAdmin.from("client_notes").insert({
    id: clientNoteId, client_id: clientId, project_id: null, type: "meeting",
    body: noteBody(note), author_id: SYSTEM_AUTHOR_ID,
    created_at: note.calendar_event?.scheduled_start_time || note.created_at,
  });
  if (error) throw new Error(`client_notes insert failed: ${error.message}`);

  await supabaseAdmin.from("granola_synced_notes").insert({ granola_note_id: noteId, client_id: clientId, client_note_id: clientNoteId });
  return "created";
}
