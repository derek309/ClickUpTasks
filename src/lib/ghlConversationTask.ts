// Shared "one open top-tier task per GHL contact thread" logic — used by the
// inbound webhook (messages, calls) and the appointment sync poll. Server-only.
import { supabaseAdmin } from "./supabaseAdmin";
import { titleCase, conversationSignalRank } from "./data";

// PostgREST PARSES the `.or()` string below — a value carrying its own filter
// syntax (comma, dot, parens) widens the match to arbitrary rows rather than
// erroring out. Real contact ids are alphanumeric plus dash/underscore, so
// anything else is refused. The public entry points that feed this a
// caller-controlled id validate against the same shape and 400 early (see
// api/external/playbook/[ghlContactId]); this is the last line of defence for
// any future caller that forgets.
export const SAFE_CONTACT_ID = /^[A-Za-z0-9_-]+$/;

// Map a contact to the tracked client that represents it — the client whose
// id is cl_<contactId>, one manually linked via linked_contact_id, or one that
// absorbed this contact in a client merge (linked_contact_ids) — falling back
// to the passed value (the sub-account) when the contact isn't a tracked
// client.
export async function resolveTrackedClientId(contactId: string, fallback: string): Promise<string> {
  if (!SAFE_CONTACT_ID.test(contactId)) return fallback;
  const { data } = await supabaseAdmin.from("clients").select("id").or(`id.eq.cl_${contactId},linked_contact_id.eq.${contactId}`).limit(1);
  if (data?.[0]) return data[0].id;
  // Absorbed-by-merge fallback (jsonb array containment) — kept as a second
  // query so the .or() above stays simple and the containment encoding is
  // handled by supabase-js rather than hand-built into an .or() string.
  const { data: merged } = await supabaseAdmin.from("clients").select("id").contains("linked_contact_ids", [contactId]).limit(1);
  return merged?.[0]?.id ?? fallback;
}

// Same resolution as above, but when a contact has NEVER been promoted to a
// tracked client (resolveTrackedClientId falls all the way through to the
// sub-account fallback), auto-create one instead of silently leaving the
// contact's activity filed under the sub-account — a real inbound
// message/call/appointment is exactly the kind of signal that should surface
// them as an actual client, not require someone to notice and add them by
// hand. Same "claimed"/"prospect" convention Cockpit.tsx's syncTerritoryClients
// and the newsletter invite-response webhook already use for this. Also
// repoints the contact's own client_id so future lookups resolve directly
// without re-triggering this promotion every time.
export async function resolveOrPromoteTrackedClient(contact: { id: string; name: string; client_id: string }): Promise<string> {
  const resolved = await resolveTrackedClientId(contact.id, contact.client_id);
  if (resolved !== contact.client_id) return resolved; // already tracked (or linked/merged) — nothing to promote

  const trackedId = "cl_" + contact.id;
  const { data: existing } = await supabaseAdmin.from("clients").select("id").eq("id", trackedId).maybeSingle();
  if (!existing) {
    const { error } = await supabaseAdmin.from("clients").insert({
      id: trackedId, name: contact.name, color: "#a855f7", ghl_location_id: "", status: "claimed", type: "prospect", assigned_to: [],
    });
    if (error) {
      // Insert failed (race with a concurrent promotion, or a real error) —
      // don't strand the caller on a client id that doesn't exist; fall back
      // to whatever's there now rather than guessing.
      console.error("[ghlConversationTask] resolveOrPromoteTrackedClient: client insert failed", error);
      return await resolveTrackedClientId(contact.id, contact.client_id);
    }
  }
  await supabaseAdmin.from("contacts").update({ client_id: trackedId }).eq("id", contact.id);
  return trackedId;
}

// A booked appointment is a real "this prospect is now in interview stage"
// signal — bump client.status to "interview" the same way claiming a
// listing bumps it to "claimed", but only from "claimed" (the no-signal-yet
// default resolveOrPromoteTrackedClient stamps on creation). Anyone already
// further along (onboarding, active_client, nurture, cancelled, past_client)
// or already at "interview" is left untouched, so this never regresses real
// progress or fights a status someone already set by hand via the Stage
// dropdown. Without this, computeBusinessStage (TerritoryDirectory.tsx) has
// no way to know an interview was booked — it just reads client.status
// as-is, and nothing else in the appointment-sync pipeline ever writes it.
export async function bumpStatusToInterview(clientId: string): Promise<void> {
  const { data: client } = await supabaseAdmin.from("clients").select("status").eq("id", clientId).maybeSingle();
  if (client?.status === "claimed") {
    await supabaseAdmin.from("clients").update({ status: "interview" }).eq("id", clientId);
  }
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
// Same system author every other server-side event line uses (see
// planner-interest, playbook toggle, granolaSync) so these render
// identically in the feed rather than looking like a real teammate posted.
const SYSTEM_AUTHOR_ID = "u_claude";
// Returns null when nothing would change — so the caller can skip a needless
// write. When the location is unchanged we return the SAME attachment object
// (not a fresh one), preserving any Vault folderId/position a user filed it
// under; only a genuinely new/removed/changed URL mints a replacement.
function withMeetingLocation(existing: { id: string; name: string; kind: string; size: string; url?: string }[], location: string | null | undefined) {
  const current = existing.find((a) => a.name === MEETING_LOCATION_ATTACHMENT_NAME);
  const rest = existing.filter((a) => a.name !== MEETING_LOCATION_ATTACHMENT_NAME);
  if (!location) return current ? rest : null; // clearing: only a change if one existed
  if (current && current.url === location) return null; // same link already present
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
    .select("id, title, attachments, comments")
    .eq("contact_id", contact.id)
    .eq("priority", "conversation")
    .neq("status", "done")
    .limit(1);
  if (openTasks && openTasks.length > 0) {
    // Bumping never RELABELS a thread on its own — a second message on an
    // already-open reply thread shouldn't silently change what it says. But
    // it DOES upgrade the title when a genuinely stronger signal arrives
    // (conversationSignalRank), because otherwise a business that opened an
    // invite email (rank 2, task created) and later actually claimed the
    // listing (rank 10) would keep showing "Opened the invite email" forever
    // — every later call here only ever touched `due`, never `title`, so the
    // strongest signal on the whole ladder could get buried at the bottom of
    // Follow Up's sort. Downgrades never happen (a later weaker signal, e.g.
    // a second email open after a real reply, leaves the stronger title in
    // place). The meeting location DOES get kept current on every poll
    // (opts.location undefined for the message/call callers, so their
    // attachments are untouched) — a rescheduled or relocated meeting's join
    // link updates here without creating a duplicate task or touching
    // anything else on it.
    const patch: Record<string, unknown> = { due, last_activity_at: new Date().toISOString() };
    if (opts?.title && conversationSignalRank(opts.title) > conversationSignalRank(openTasks[0].title)) {
      patch.title = opts.title;
    }
    // Keep the whole journey, not just the latest headline (Derek,
    // 2026-08-11 — "open, click, start chat, book, etc, keep all the
    // history"). The title only ever shows the STRONGEST signal so far, so
    // without this every earlier step was silently overwritten and the
    // sequence that actually tells you how warm a business got was lost.
    // Each named signal appends one compact event line to the same feed
    // TaskDrawer already renders, oldest at the top.
    //
    // Only named signals (opts.title) log — the message/call pollers bump
    // `due` with no title on every sync, and logging those would bury the
    // real milestones under a wall of no-op lines. Consecutive duplicates
    // are skipped too, so a webhook redelivering the same open/click event
    // doesn't repeat itself.
    if (opts?.title) {
      const comments: { kind?: string; body?: string }[] = Array.isArray(openTasks[0].comments) ? openTasks[0].comments : [];
      const lastEvent = [...comments].reverse().find((c) => c?.kind === "event");
      if (lastEvent?.body !== opts.title) {
        patch.comments = [...comments, {
          id: "cm_" + crypto.randomUUID(), authorId: SYSTEM_AUTHOR_ID,
          body: opts.title, at: new Date().toISOString(), kind: "event",
        }];
      }
    }
    if (opts?.location !== undefined) {
      const next = withMeetingLocation(openTasks[0].attachments ?? [], opts.location);
      if (next !== null) patch.attachments = next; // null = location unchanged, don't churn the attachment
    }
    await supabaseAdmin.from("tasks").update({ ...patch, updated_by: null }).eq("id", openTasks[0].id);
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
    last_activity_at: new Date().toISOString(),
    created_by: null,
    // Seed the history with the signal that created the task, so the feed
    // reads as a complete sequence from the first touch rather than
    // starting at whatever happened second.
    comments: opts?.title
      ? [{ id: "cm_" + crypto.randomUUID(), authorId: SYSTEM_AUTHOR_ID, body: opts.title, at: new Date().toISOString(), kind: "event" }]
      : [],
    // On a brand-new task there's nothing to preserve, so a null "no change"
    // result just means "no meeting location" — fall back to the base array.
    attachments: (() => { const base = ghlUrl ? [{ id: "at_" + crypto.randomUUID(), name: "GHL conversation", kind: "link", size: "", url: ghlUrl }] : []; return withMeetingLocation(base, opts?.location) ?? base; })(),
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
