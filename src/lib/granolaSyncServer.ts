// SERVER-ONLY: files a Granola meeting note into the right client's Journal.
// Shared by the webhook route (real-time) and the manual backfill sync route.
// Matches the "match an external event to a known Contact by email, then
// file it" pattern already used by src/lib/inboundIngest.ts and
// src/app/api/google/poll-replies/route.ts.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { granolaGetNote } from "./granolaClient";
import { resolveOrPromoteTrackedClient } from "./ghlConversationTask";
import { contactsByEmail } from "./contactsByEmail";
import { TASK_FILES_BUCKET } from "./db";
import { ensureMeetingSteps, stepsOnMeetingTranscript } from "./stepsServer";
import type { Subtask } from "./data";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SYSTEM_AUTHOR_ID = "u_derek";

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

  const contactByEmail = await contactsByEmail<any>("id, name, client_id, email");
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
  try { await transcriptOntoTask(clientId, note); } catch (e) { console.error("[granolaSync] transcript onto task failed", e); }
  return "created";
}

// The meeting as a text file: summary, then who said what. Plain text so the
// file viewer and Claude's view_task_file both read it.
function transcriptText(note: Awaited<ReturnType<typeof granolaGetNote>>): string {
  const title = note.title || note.calendar_event?.event_title || "Meeting";
  const when = note.calendar_event?.scheduled_start_time || note.created_at;
  const lines = (note.transcript ?? [])
    .map((t) => {
      const text = (t.text ?? "").trim();
      if (!text) return "";
      const who = t.speaker?.diarization_label || (t.speaker?.source === "microphone" ? "Us" : t.speaker?.source === "speaker" ? "Them" : "");
      return who ? `${who}: ${text}` : text;
    })
    .filter(Boolean);
  const summary = note.summary_text?.trim() || note.summary_markdown?.trim() || "";
  return [
    title, new Date(when).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "full", timeStyle: "short" }),
    note.web_url ? `Granola: ${note.web_url}` : "",
    summary ? `\nSUMMARY\n${summary}` : "",
    lines.length ? `\nTRANSCRIPT\n${lines.join("\n")}` : "\n(Granola sent no transcript for this meeting.)",
  ].filter(Boolean).join("\n");
}

/** A booked meeting's task waits on its transcript ("Add the meeting
 *  transcript", data.withMeetingSteps). The client's open task whose step is
 *  due nearest the meeting gets the file and the step ticks. */
async function transcriptOntoTask(clientId: string, note: Awaited<ReturnType<typeof granolaGetNote>>): Promise<void> {
  const { data: tasks } = await supabaseAdmin.from("tasks").select("id, subtasks")
    .eq("client_id", clientId).neq("status", "done").is("deleted_at", null);
  const meetingDay = (note.calendar_event?.scheduled_start_time || note.created_at).slice(0, 10);
  const dayGap = (d?: string | null) => (d ? Math.abs(Date.parse(d) - Date.parse(meetingDay)) : Infinity);
  const waiting = (tasks ?? [])
    .map((t: any) => ({ id: t.id as string, step: ((t.subtasks as Subtask[] | null) ?? []).find((x) => !x.done && x.finishWhen === "transcript") }))
    .filter((t) => t.step && dayGap(t.step.due) <= 3 * 86400000)
    .sort((a, b) => dayGap(a.step!.due) - dayGap(b.step!.due))[0];
  if (!waiting) return;
  await fileTranscript(waiting.id, note);
}

async function fileTranscript(taskId: string, note: Awaited<ReturnType<typeof granolaGetNote>>): Promise<string> {
  const meetingDay = (note.calendar_event?.scheduled_start_time || note.created_at).slice(0, 10);
  const waiting = { id: taskId };
  const body = transcriptText(note);
  const name = `Meeting transcript ${meetingDay}.txt`;
  const path = `${waiting.id}/${randomUUID().slice(0, 8)}-${name.replace(/\s+/g, "-")}`;
  const { error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).upload(path, Buffer.from(body, "utf8"), { contentType: "text/plain; charset=utf-8", upsert: false });
  if (error) throw new Error(`upload failed: ${error.message}`);
  const bytes = Buffer.byteLength(body, "utf8");
  const att = { id: "a_" + randomUUID().slice(0, 12), name, kind: "doc", size: bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`, path, mimeType: "text/plain" };
  const { error: rpcError } = await supabaseAdmin.rpc("append_task_attachments", { task_id: waiting.id, items: [att] });
  if (rpcError) throw new Error(`attach failed: ${rpcError.message}`);
  await stepsOnMeetingTranscript(waiting.id, att.id);
  return name;
}

/** Client work's Add, Meeting transcript (Derek, 2026-10-12): the steps if
 *  the task has none, then the client's Granola meeting nearest the step's
 *  date, from the last two weeks, filed now. For a meeting Granola sent
 *  before the step was there. */
export async function transcriptForTask(taskId: string): Promise<{ ok: true; filed: string | null } | { ok: false; error: string }> {
  await ensureMeetingSteps(taskId);
  const { data: task } = await supabaseAdmin.from("tasks").select("client_id, subtasks").eq("id", taskId).maybeSingle();
  if (!task) return { ok: false, error: "No such task." };
  const step = ((task.subtasks as Subtask[] | null) ?? []).find((x) => !x.done && x.finishWhen === "transcript");
  if (!step) return { ok: false, error: "Couldn't add the transcript step." };
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: notes } = await supabaseAdmin.from("granola_synced_notes").select("granola_note_id, client_note_id").eq("client_id", task.client_id).not("client_note_id", "is", null);
  if (!notes?.length) return { ok: true, filed: null };
  const { data: meetings } = await supabaseAdmin.from("client_notes").select("id, created_at").in("id", notes.map((n: any) => n.client_note_id)).gte("created_at", since);
  const target = Date.parse(step.due ?? new Date().toISOString().slice(0, 10));
  const nearest = (meetings ?? []).sort((a: any, b: any) => Math.abs(Date.parse(a.created_at) - target) - Math.abs(Date.parse(b.created_at) - target))[0];
  if (!nearest) return { ok: true, filed: null };
  const noteId = notes.find((n: any) => n.client_note_id === nearest.id)!.granola_note_id;
  return { ok: true, filed: await fileTranscript(taskId, await granolaGetNote(noteId)) };
}
