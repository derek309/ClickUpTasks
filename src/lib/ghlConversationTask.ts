// Shared "one open top-tier task per GHL contact thread" logic — used by the
// inbound webhook (messages, calls) and the appointment sync poll. Server-only.
import { supabaseAdmin } from "./supabaseAdmin";
import { titleCase } from "./data";

// Map a contact to the tracked client that represents it — the client whose
// id is cl_<contactId>, one manually linked via linked_contact_id, or one that
// absorbed this contact in a client merge (linked_contact_ids) — falling back
// to the passed value (the sub-account) when the contact isn't a tracked
// client. Contact ids are alphanumeric + underscore, safe to interpolate.
export async function resolveTrackedClientId(contactId: string, fallback: string): Promise<string> {
  const { data } = await supabaseAdmin.from("clients").select("id").or(`id.eq.cl_${contactId},linked_contact_id.eq.${contactId}`).limit(1);
  if (data?.[0]) return data[0].id;
  // Absorbed-by-merge fallback (jsonb array containment) — kept as a second
  // query so the .or() above stays simple and the containment encoding is
  // handled by supabase-js rather than hand-built into an .or() string.
  const { data: merged } = await supabaseAdmin.from("clients").select("id").contains("linked_contact_ids", [contactId]).limit(1);
  return merged?.[0]?.id ?? fallback;
}

// "Today" for a Conversation task's due date, in the team's operating
// timezone (Pacific) rather than the server's UTC clock — due doubles as
// "last touched" here (see below), and a UTC-computed date can already be
// tomorrow for a US-based reply that just arrived this evening, which would
// misrender as "Tomorrow" in the UI's local-time due-date formatting.
export function todayPacific(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

// Same conversion, for an arbitrary instant (e.g. an appointment's start
// time) rather than "now" — used so a booked meeting's due date reflects
// when it actually happens, not when it was synced.
export function toPacificDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(iso));
}

// Priority-system spec (see PRIORITY_META in src/lib/data.ts): every inbound
// reply/call/appointment keeps exactly one open Conversation-priority task
// per contact thread — a second touch on the same contact's thread that
// already has one open just bumps its due date rather than creating a
// duplicate, per the spec's own "Due date updates" section. Scoped by
// contact_id, not client_id — a client can have multiple GHL contacts, each
// with their own thread, and conflating them would silently merge one
// contact's activity into another's task. due doubles as "last touched" for
// messages/calls (defaults to today) but is the real appointment time for a
// meeting (opts.due) — either way Conversation always sorts to the top on
// priority alone, so this never affects whether it's the top tier, only what
// date displays on the row. Conversation tasks are never auto-completed
// (spec) — only this creation/bump path writes to them; completion is left
// entirely to a person.
//
// The open-task lookup is check-then-act, not backed by a DB constraint that
// would make it atomic (see supabase/conversation-task-unique.sql) — instead
// the unique partial index there catches the concurrent-insert race: if two
// deliveries for the same contact both reach the insert, the loser's insert
// fails on that constraint and is treated as "someone else already created
// it," same conservative spirit as the ghl_message_id dedup in the webhook.
// Returns the resolved/created Conversation task's id, or null if it
// couldn't be resolved — a lost race against a concurrent delivery for the
// same contact, or a real insert failure (already logged below).
// A booked appointment's join link/location, kept as its own named
// attachment rather than written into the task's free-text description —
// the description is a person's own notes, and an appointment-details sync
// silently overwriting it on every poll would be destructive. An attachment
// is safe to replace wholesale: find-by-name, swap it out, leave everything
// else (including any manually attached files) untouched.
const MEETING_LOCATION_ATTACHMENT_NAME = "Meeting location";
function withMeetingLocation(existing: { id: string; name: string; kind: string; size: string; url?: string }[], location: string | null | undefined) {
  const rest = existing.filter((a) => a.name !== MEETING_LOCATION_ATTACHMENT_NAME);
  if (!location) return rest;
  return [...rest, { id: "at_" + crypto.randomUUID(), name: MEETING_LOCATION_ATTACHMENT_NAME, kind: "link", size: "", url: location }];
}

export async function upsertConversationTask(
  contact: { id: string; name: string; client_id: string },
  ghlContactId: string,
  opts?: { due?: string; title?: string; location?: string | null },
): Promise<string | null> {
  const due = opts?.due ?? todayPacific();
  const { data: openTasks } = await supabaseAdmin
    .from("tasks")
    .select("id, attachments")
    .eq("contact_id", contact.id)
    .eq("priority", "conversation")
    .neq("status", "done")
    .limit(1);
  if (openTasks && openTasks.length > 0) {
    // Bumping never touches title — a second message on a thread that
    // already has an open task shouldn't silently relabel it. The meeting
    // location DOES get kept current on every poll (opts.location undefined
    // for the message/call callers, so their attachments are untouched) —
    // this is the "pushed and kept up to date" part: a rescheduled or
    // relocated meeting's join link updates here without creating a
    // duplicate task or touching anything else on it.
    const patch: Record<string, unknown> = { due };
    if (opts?.location !== undefined) patch.attachments = withMeetingLocation(openTasks[0].attachments ?? [], opts.location);
    await supabaseAdmin.from("tasks").update(patch).eq("id", openTasks[0].id);
    return openTasks[0].id;
  }

  // Reuse whatever project the client's other tasks live under, same "Tasks"
  // fallback quickAdd/GHL-import use client-side when a client has none yet.
  let projectId: string | undefined = (
    await supabaseAdmin.from("projects").select("id").eq("client_id", contact.client_id).limit(1).maybeSingle()
  ).data?.id;
  if (!projectId) {
    projectId = "p_" + crypto.randomUUID();
    const { error: projErr } = await supabaseAdmin.from("projects").insert({ id: projectId, client_id: contact.client_id, name: "Tasks", description: "" });
    if (projErr) { console.error("[ghlConversationTask] upsertConversationTask: fallback project insert failed", projErr); return null; }
  }

  const { data: client } = await supabaseAdmin.from("clients").select("ghl_location_id").eq("id", contact.client_id).maybeSingle();
  const ghlUrl = client?.ghl_location_id ? `https://app.gohighlevel.com/v2/location/${client.ghl_location_id}/contacts/detail/${ghlContactId}` : null;

  const newTaskId = "t_" + crypto.randomUUID();
  const { error: taskErr } = await supabaseAdmin.from("tasks").insert({
    id: newTaskId,
    project_id: projectId,
    client_id: contact.client_id,
    title: opts?.title ?? `Reply to ${titleCase(contact.name)}`,
    priority: "conversation",
    contact_id: contact.id,
    due,
    attachments: withMeetingLocation(ghlUrl ? [{ id: "at_" + crypto.randomUUID(), name: "GHL conversation", kind: "link", size: "", url: ghlUrl }] : [], opts?.location),
  });
  // A concurrent delivery for the same contact can lose the race to the
  // partial unique index in conversation-task-unique.sql — that's the other
  // request's insert having already won, not a real failure.
  if (taskErr) {
    if (!taskErr.message.includes("duplicate key")) console.error("[ghlConversationTask] upsertConversationTask: task insert failed", taskErr);
    return null;
  }
  return newTaskId;
}
