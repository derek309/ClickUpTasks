import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import {
  describeRecurrence, htmlToText, initialsOf, splitQuotedEmail, tidyEmailText,
  type Attachment, type Recurrence, type RecurrenceUnit, type Subtask,
} from "@/lib/data";
import { TASK_FILES_BUCKET } from "@/lib/db";
import { QUEUE_TASK_COLS, portalQueueMarks, queueSettings, queueTaskFromRow, type QueueSettings } from "../../../../../mcp/queue.mjs";
import { rateLimit } from "@/lib/rateLimit";
import { resolveWaitingToken } from "@/lib/waitingToken";
import { orderLists } from "@/lib/listOrder";
import { portalRequestFromTask } from "@/lib/portalRequests";
import { clientFirstName } from "@/lib/clientFirstName";
import { requestFromTask } from "@/lib/clientRequests";

// Public, deliberately unauthenticated — the first route of its kind in this
// app. Backs /waiting/[token], a client-facing page showing "here's what
// we're waiting on you for" (see supabase/client-share-token.sql). The
// token itself IS the access control: it's a 122-bit random value, matched
// on clients.share_token, and this route only ever returns that one
// client's name plus its own tasks — no assignee names, comments, or any
// other client's data reaches this response, on purpose.
//
// A task appears here while it's still waiting on the client, OR once the
// client has submitted a response (see ./respond/route.ts) — kept visible
// through "submitted, the team's on it" and "done" so the client can watch
// it through to completion instead of it silently vanishing once answered.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await rateLimit(req, token, "read");
  if (limited) return limited;

  const scope = await resolveWaitingToken(token);
  if (!scope) return NextResponse.json({ error: "Not found" }, { status: 404 });


  // A link composed from one specific task (see the task drawer's email
  // composer) carries ?task=<id> so that task shows up here even when it's
  // neither waiting-on-client nor already answered — e.g. a plain "this is
  // done" status update the client should be able to see, not just tasks
  // that need their input.
  const deepLinkTaskId = req.nextUrl.searchParams.get("task");
  // ?detail=<id>: one task in full, for a finished task the list sent in
  // short (below). Scoped exactly like every other row here.
  const detailTaskId = req.nextUrl.searchParams.get("detail");

  // The client's own project list — lets the page group tasks by list and
  // offer a switcher when there's more than one, instead of one flat pile.
  // Only id/name leave this route; nothing else about a project is public.
  // A project-scoped token additionally filters this down to its own id, so
  // there is exactly one project here and the page's own switcher never
  // renders (same `projects.length > 1` check it already uses).
  let projectQuery = supabaseAdmin.from("projects").select("id, name, position").eq("client_id", scope.clientId).eq("hidden_from_client", false).is("deleted_at", null);
  if (scope.projectId) projectQuery = projectQuery.eq("id", scope.projectId);
  // In the order of the list tabs in the app (lib/listOrder).
  const { data: rawProjectRows } = await projectQuery;
  const projectRows = rawProjectRows ? orderLists(rawProjectRows as { id: string; name: string; position: number | null }[]) : rawProjectRows;
  // Queue lists (mcp/queue.mjs): the "What we're doing" tab shows what is
  // Now and what is in line, in order, with no dates for the line. Read only
  // when the database has the queue column; otherwise no list is a queue.
  const queues = new Map<string, QueueSettings>();
  if (projectRows?.length) {
    const { data: queueRows, error: queueErr } = await supabaseAdmin.from("projects").select("id, queue").in("id", projectRows.map((p) => p.id as string));
    if (!queueErr) for (const r of (queueRows ?? []) as { id: string; queue: unknown }[]) { const q = queueSettings(r.queue); if (q) queues.set(r.id, q); }
  }
  const projects = (projectRows ?? []).map((p) => ({ id: p.id as string, name: p.name as string, ...(queues.has(p.id as string) ? { queue: true } : {}) }));
  // Each open task's place: the line is worked out over the whole list (its
  // private and hidden tasks are in it too), and the places are counted over
  // what this page shows, so nothing hidden leaves a gap.
  const queueMarks = new Map<string, { queue: "now" | "line"; place: string | null }>();
  for (const [listId, q] of queues) {
    const { data: listRows, error: listErr } = await supabaseAdmin.from("tasks").select(`${QUEUE_TASK_COLS}, is_private, hidden_from_client`).eq("client_id", scope.clientId).eq("project_id", listId).is("deleted_at", null).neq("status", "done");
    if (listErr) continue;
    const raw = (listRows ?? []) as unknown as Record<string, unknown>[];
    const shown = new Set(raw.filter((r) => r.is_private !== true && r.hidden_from_client !== true).map((r) => r.id as string));
    for (const [id, mark] of portalQueueMarks(raw.map(queueTaskFromRow), q, (t) => shown.has(t.id))) queueMarks.set(id, mark);
  }

  type Row = {
    id: string; project_id: string | null; title: string; due: string | null; description: string | null; status: string;
    waiting_on_client: boolean | null; client_response: { body: string; attachments: Attachment[]; submittedAt: string } | null;
    attachments: Attachment[] | null; updated_at: string | null; completed_at?: string | null;
    recurrence?: string | null; recurrence_interval?: number | null; recurrence_unit?: string | null;
    recurrence_days_of_month?: number[] | null; recurrence_nth?: number | null; recurrence_weekday?: number | null;
  };
  const cols = "id, project_id, title, due, description, status, waiting_on_client, client_response, attachments, updated_at, subtasks, recurrence, recurrence_interval, recurrence_unit, recurrence_days_of_month, recurrence_nth, recurrence_weekday";
  // is_private tasks never reach a public page, whatever client they're filed
  // under — RLS protects them from other teammates, but this route reads with
  // the service role, so the filter has to be explicit here. A project-scoped
  // token adds project_id to every one of these — the entire reason a list
  // token exists is that nothing outside that one project should ever be
  // reachable through it, regardless of what a caller passes as ?task=.
  // Trashed tasks are excluded the same way, so a deep link to one 404s too.
  const scopedTaskQuery = (columns = cols) => {
    let q = supabaseAdmin.from("tasks").select(columns).eq("client_id", scope.clientId).eq("is_private", false).eq("hidden_from_client", false).is("deleted_at", null);
    if (scope.projectId) q = q.eq("project_id", scope.projectId);
    return q;
  };
  // With portal_shows_all_tasks on, the client also sees the rest of the
  // account: everything still open (so they can see what the team is working
  // on) plus what is finished. Still never private tasks, and a
  // project-scoped token still only ever reaches its own project.
  //
  // Finished work (Derek, 2026-10-13: the Done tab by month, all 162 of
  // Brian's): every task finished in the last 13 months, plus a count of the
  // ones before. Only those finished in the last 30 days come in full; the
  // rest come short (title, list, dates) and a click fetches one with
  // ?detail=, so a 15 second refresh stays light however long the history.
  // When it was finished is completed_at (supabase/task-completed-at.sql),
  // read when the column is there and updated_at until it is; updated_at is
  // never earlier than completed_at, so filtering on it never drops a row.
  const DONE_MONTHS = 13;
  const FULL_DAYS = 30;
  const doneSince = new Date(Date.now() - DONE_MONTHS * 31 * 86400000).toISOString();
  const fullSince = new Date(Date.now() - FULL_DAYS * 86400000).toISOString();
  const loadDone = async (): Promise<Row[]> => {
    const ask = (columns: string) => scopedTaskQuery(columns).eq("status", "done").gte("updated_at", doneSince).order("updated_at", { ascending: false }).limit(1000);
    const withDate = await ask(`${cols}, completed_at`);
    if (!withDate.error) return (withDate.data ?? []) as unknown as Row[];
    return ((await ask(cols)).data ?? []) as unknown as Row[];
  };
  const countOlderDone = async (): Promise<number> => {
    let q = supabaseAdmin.from("tasks").select("id", { count: "exact", head: true }).eq("client_id", scope.clientId).eq("is_private", false).eq("hidden_from_client", false).is("deleted_at", null).eq("status", "done").lt("updated_at", doneSince);
    if (scope.projectId) q = q.eq("project_id", scope.projectId);
    return (await q).count ?? 0;
  };
  const clientId = scope.clientId;
  // What the page calls them ("Thanks, Brian."): the contact's first name when
  // the contact is a person, else the client's name. Only that leaves here.
  const contactId = scope.linkedContactId || (clientId.startsWith("cl_") ? clientId.slice(3) : null);
  const { data: contact } = contactId ? await supabaseAdmin.from("contacts").select("name, company").eq("id", contactId).maybeSingle() : { data: null };
  const firstName = clientFirstName(contact as { name?: string | null; company?: string | null } | null, scope.clientName, "");
  const finishedAt = (t: Row) => (t.status === "done" ? t.completed_at ?? t.updated_at ?? null : null);

  // Every row as the page reads it. Rows not in `full` (finished a while
  // ago) come short: no description, files, thread or changes; the page
  // fetches one in full with ?detail= when it is opened.
  async function buildTasks(rows: Row[], full: Set<string>) {

    // Resolve any attachment's storage path to a short-lived signed URL — used
    // for both the task's own attachments (mockups/screenshots/staging links
    // the team put there for the client to review) and the client's own reply
    // attachments.
    const resolveAttachments = async (list: Attachment[]) => Promise.all(list.map(async (a) => ({
      id: a.id, name: a.name, kind: a.kind, size: a.size, path: a.path ?? null,
      url: a.path ? (await supabaseAdmin.storage.from(TASK_FILES_BUCKET).createSignedUrl(a.path, 3600)).data?.signedUrl ?? null : a.url ?? null,
    })));

    // The per-task chat thread (see ./messages/route.ts) — every message
    // already scoped to a task via task_id, so this is the same data the
    // team's own task drawer reads, just filtered to this client and stripped
    // to a public-safe shape (no createdBy, no ghl/gmail ids, no cc/bcc).
    type MessageRow = { id: string; task_id: string | null; direction: string; body: string; created_at: string; attachments: Attachment[] | null; created_by: string | null; channel: string | null };
    const taskIds = rows.filter((t) => full.has(t.id)).map((t) => t.id);
    const { data: messageRows } = taskIds.length
      ? await supabaseAdmin.from("messages").select("id, task_id, direction, body, created_at, attachments, created_by, channel")
          .eq("client_id", clientId).in("task_id", taskIds)
          // The app's own "X replied on ..." email, brought in from Gmail and
          // linked to the task for the team's Inbox, is not part of their
          // conversation (it showed as the client writing it).
          .or("peer_name.is.null,peer_name.neq.ClickUpTasks")
          .order("created_at", { ascending: true })
      : { data: [] as MessageRow[] };
    const threadByTask = new Map<string, MessageRow[]>();
    for (const m of (messageRows ?? []) as MessageRow[]) {
      if (!m.task_id) continue;
      const list = threadByTask.get(m.task_id) ?? [];
      list.push(m);
      threadByTask.set(m.task_id, list);
    }

    // Who sent each outbound message — so the client sees a face/name, not
    // just "Team". Batched once for every sender across every task, not
    // per-message: name/color/avatar are the only profile fields that leave
    // this public route.
    const senderIds = Array.from(new Set((messageRows ?? []).map((m) => m.created_by).filter((id): id is string => !!id)));
    const { data: senderRows } = senderIds.length
      ? await supabaseAdmin.from("profiles").select("member_id, name, color, avatar_url, email_signature").in("member_id", senderIds)
      : { data: [] as { member_id: string; name: string; color: string; avatar_url: string | null; email_signature: string | null }[] };
    // Their phone, read from their email signature (the one place it is kept),
    // so the client can call or text the person on it.
    const phoneOf = (sig: unknown) => (typeof sig === "string" ? htmlToText(sig).match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ?? null : null);
    const senderById = new Map((senderRows ?? []).map((p) => [p.member_id as string, {
      name: (p.name as string) || "Team", avatarUrl: (p.avatar_url as string | null) ?? null,
      color: (p.color as string) || "#1b3a5c", initials: initialsOf((p.name as string) || "Team"),
      phone: phoneOf(p.email_signature),
    }]));

    // Which tasks have a client document (Derek, 2026-10-05: a doc lives on a
    // task, added like a file or a link). Only whether one exists leaves here;
    // opening it goes through ./doc, which hands back its link.
    const { data: docRows } = taskIds.length
      ? await supabaseAdmin.from("task_documents").select("task_id, kind, status").is("deleted_at", null).in("task_id", taskIds)
      : { data: [] as { task_id: string; kind: string; status: string }[] };
    const withDoc = new Set((docRows ?? []).filter((d) => d.kind === "doc").map((d) => d.task_id as string));
    // The review a task is for, whatever its kind, once it has gone to them: a
    // task that is a review opens straight into it (Derek, 2026-10-08).
    const SHARED = ["with_client", "client_submitted", "approved"];
    const reviewByTask = new Map<string, string>();
    // A review still waiting on their answer: their request is to look it over.
    const reviewOpen = new Set((docRows ?? []).filter((d) => d.status === "with_client").map((d) => d.task_id as string));
    for (const d of docRows ?? []) {
      if (!SHARED.includes(d.status as string)) continue;
      const had = reviewByTask.get(d.task_id as string);
      if (!had || d.status === "with_client") reviewByTask.set(d.task_id as string, d.kind as string);
    }

    return Promise.all(rows.map(async (t) => {
      // How often it repeats, in the app's words, for the Done tab's ongoing work.
      const repeat = t.recurrence && t.recurrence !== "none"
        ? describeRecurrence(t.recurrence as Recurrence, t.recurrence_interval ?? undefined, (t.recurrence_unit ?? undefined) as RecurrenceUnit | undefined, t.recurrence_days_of_month ?? undefined, t.recurrence_nth ?? undefined, t.recurrence_weekday ?? undefined)
        : null;
      if (!full.has(t.id)) return {
        id: t.id, projectId: t.project_id ?? null, title: t.title, due: t.due ?? null, description: "",
        status: t.status, needsResponse: t.waiting_on_client === true, doneAt: finishedAt(t), repeat,
        hasDoc: false, review: null, attachments: [], response: null, thread: [], changes: [], short: true,
      };
      const cr = t.client_response as { body: string; attachments: Attachment[]; submittedAt: string } | null;
      // What we need from them on it, one thing at a time (lib/portalRequests).
      const request = portalRequestFromTask({
        id: t.id, title: t.title, clientId, projectId: t.project_id ?? null, due: t.due ?? null, status: t.status,
        waitingOnClient: t.waiting_on_client === true, subtasks: ((t as Record<string, unknown>).subtasks as Subtask[] | null) ?? null,
      }, { firstName, reviewOpen: reviewOpen.has(t.id) });
      const threadRows = threadByTask.get(t.id) ?? [];
      const [attachments, responseAttachments, thread] = await Promise.all([
        resolveAttachments(t.attachments ?? []),
        cr ? resolveAttachments(cr.attachments) : Promise.resolve([]),
        Promise.all(threadRows.map(async (m) => ({
          id: m.id,
          // "inbound" is team-side terminology (inbound TO the team) — from
          // here it's the client's own message, so this is the one field
          // worth translating rather than leaking the app's internal framing.
          from: m.direction === "inbound" ? "client" as const : "team" as const,
          // An email without the earlier ones quoted under it, the way the team's
          // Inbox shows it (Derek, 2026-10-08: the thread was every reply again).
          body: m.channel === "email" ? splitQuotedEmail(tidyEmailText(htmlToText(m.body ?? ""))).visible : htmlToText(m.body ?? ""),
          at: m.created_at,
          // A file left in Gmail comes through ./attachment, which checks the
          // message is on one of this client's tasks before reading it.
          attachments: await resolveAttachments((m.attachments ?? []).map((a) => ((a as { gmailAttachmentId?: string }).gmailAttachmentId && !a.path && !a.url
            ? { ...a, url: `/api/waiting/${encodeURIComponent(token)}/attachment?message=${encodeURIComponent(m.id)}&att=${encodeURIComponent(a.id)}` }
            : a))),
          sender: m.direction === "outbound" && m.created_by ? senderById.get(m.created_by) ?? null : null,
        }))),
      ]);
      return {
        id: t.id, projectId: t.project_id ?? null, title: t.title, due: t.due ?? null,
        // Stripped to plain text server-side — no HTML ever reaches this public
        // response, and the page never needs the TipTap editor bundle to render it.
        description: htmlToText(t.description ?? ""),
        status: t.status, needsResponse: !!request, request,
        // When it was finished, for "Done Oct 3": completed_at, else the last change.
        doneAt: finishedAt(t), repeat,
        hasDoc: withDoc.has(t.id),
        review: reviewByTask.get(t.id) ?? null,
        // Mockups/screenshots/staging links the team attached — the "review
        // pages, media, etc" surface, so the client sees what they're
        // approving/responding to, not just a text description.
        attachments,
        response: cr ? { body: cr.body, submittedAt: cr.submittedAt, attachments: responseAttachments } : null,
        thread,
        // Their changes and whether each is done; never the team's own checklist.
        changes: (((t as Record<string, unknown>).subtasks as { id: string; title: string; done: boolean; fromClient?: boolean }[] | null) ?? [])
          .filter((s) => s.fromClient).map((s) => ({ id: s.id, title: s.title, done: !!s.done })),
      };
    }));
  }

  // One task in full, for a finished one the list sent short.
  if (detailTaskId) {
    const one = await scopedTaskQuery(`${cols}, completed_at`).eq("id", detailTaskId);
    const { data } = one.error ? await scopedTaskQuery().eq("id", detailTaskId) : one;
    const row = (data ?? [])[0] as unknown as Row | undefined;
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [task] = await buildTasks([row], new Set([row.id]));
    return NextResponse.json({ task });
  }

  const [{ data: waiting }, { data: responded }, { data: deepLinked }, { data: allOpen }, recentDone, olderDone] = await Promise.all([
    scopedTaskQuery().eq("waiting_on_client", true),
    scopedTaskQuery().not("client_response", "is", null),
    // Proven to belong to this client (and this project, if scoped) before
    // it's allowed to appear — a task id is not itself a secret, so this
    // must never trust deepLinkTaskId alone.
    deepLinkTaskId
      ? scopedTaskQuery().eq("id", deepLinkTaskId)
      : Promise.resolve({ data: [] as Row[] }),
    scope.showAllTasks
      ? scopedTaskQuery().neq("status", "done")
      : Promise.resolve({ data: [] as Row[] }),
    scope.showAllTasks ? loadDone() : Promise.resolve([] as Row[]),
    scope.showAllTasks ? countOlderDone() : Promise.resolve(0),
  ]);
  const byId = new Map<string, Row>();
  [...(waiting ?? []), ...(responded ?? []), ...(deepLinked ?? []), ...(allOpen ?? [])].forEach((t) => byId.set((t as unknown as Row).id, t as unknown as Row));
  // Every task whose current step is theirs is something we need from them,
  // whether or not the portal lists the whole account: read light first, the
  // ones not already here in full after.
  if (!scope.showAllTasks) {
    const { data: openLight } = await scopedTaskQuery("id, title, subtasks").not("status", "in", "(done,on_hold)").limit(1000);
    const want = ((openLight ?? []) as unknown as { id: string; title: string; subtasks: Subtask[] | null }[])
      .filter((t) => !byId.has(t.id) && requestFromTask({ id: t.id, title: t.title, clientId, subtasks: t.subtasks }))
      .map((t) => t.id);
    for (let i = 0; i < want.length; i += 200) {
      const { data: more } = await scopedTaskQuery().in("id", want.slice(i, i + 200));
      for (const t of (more ?? []) as unknown as Row[]) byId.set(t.id, t);
    }
  }
  // A finished task out of the 13 months by its real finish date counts as older.
  let olderCount = olderDone;
  for (const t of recentDone) {
    if (byId.has(t.id)) { byId.set(t.id, { ...byId.get(t.id)!, completed_at: t.completed_at }); continue; }
    if ((finishedAt(t) ?? "") < doneSince) { olderCount++; continue; }
    byId.set(t.id, t);
  }
  const rows = [...byId.values()].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const full = new Set(rows.filter((t) => t.status !== "done" || (finishedAt(t) ?? "") >= fullSince || t.id === deepLinkTaskId || t.waiting_on_client || t.client_response).map((t) => t.id));
  const tasks = (await buildTasks(rows, full)).map((t) => {
    const mark = t.status !== "done" ? queueMarks.get(t.id) : undefined;
    // In line: its place, never a date (the queue sets one when its turn comes).
    return mark ? { ...t, queue: mark.queue, place: mark.place, ...(mark.queue === "line" ? { due: null } : {}) } : t;
  });

  // Whether this client may raise brand-new tasks here at all — the page uses
  // it to show or hide the "Add Something" composer. Not a permission the
  // page enforces: ./request/route.ts re-checks the same column before it
  // writes anything, so this is purely so the client isn't offered a button
  // that would only refuse them (see supabase/client-request-new-tasks.sql).
  // Always false for a project-scoped token (see resolveWaitingToken).
  return NextResponse.json({ clientName: scope.clientName, firstName, canRequestNewTasks: scope.canRequestNewTasks, projects, tasks, olderDone: olderCount, deepLinkTaskId: deepLinkTaskId || null });
}
