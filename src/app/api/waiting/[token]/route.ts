import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import {
  htmlToText, initialsOf, PERSONAL_CLIENT_ID, playbookCompletion,
  PLAYBOOK_ALL_STEPS, PLAYBOOK_PHASES, PLAYBOOK_A2P_PHASE, PLAYBOOK_EMAIL_DOMAIN_PHASE, PLAYBOOK_ONGOING_PHASE,
  type Attachment,
} from "@/lib/data";
import { reconcilePlaybookTasksServer } from "@/lib/playbookReconcileServer";
import { TASK_FILES_BUCKET } from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";

// Phase section headers, written for the business reading them rather than
// the rep — the internal labels ("— side quest," "(ambassador)") are correct
// in Cockpit.tsx for a rep audience but would confuse or read oddly to the
// client seeing their own account described that way. Only overrides the
// phases where that's actually true; every other phase's own label already
// reads fine either way. A first, deliberately small step toward the
// internal/client-facing split the game plan still wants finished — not a
// new schema field yet, just the one place this page needs it today.
const CLIENT_PHASE_LABEL: Record<string, string> = {
  a2p: "Turn on texting",
  email_domain: "Set up your email domain",
  ongoing: "Ongoing",
};

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

  const { data: client } = await supabaseAdmin.from("clients").select("id, name, can_request_new_tasks").eq("share_token", token).maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // "personal" is the pseudo-client every teammate's private tasks share, not
  // a real client — a token on it would publish all of them here. Minting one
  // is refused upstream; this is the serve-side half of the same guard, so a
  // token written before that guard existed (or by hand) still can't be used.
  if (client.id === PERSONAL_CLIENT_ID) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Ensures this client's Playbook step tasks exist even if no rep has ever
  // opened their Businesses page entry — the first thing that touches a
  // client (an invite reply, a claim, or just this page loading) shouldn't
  // be a prerequisite for seeing accurate progress below.
  await reconcilePlaybookTasksServer(client.id);

  // A link composed from one specific task (see the task drawer's email
  // composer) carries ?task=<id> so that task shows up here even when it's
  // neither waiting-on-client nor already answered — e.g. a plain "this is
  // done" status update the client should be able to see, not just tasks
  // that need their input.
  const deepLinkTaskId = req.nextUrl.searchParams.get("task");

  // The client's own project list — lets the page group tasks by list and
  // offer a switcher when there's more than one, instead of one flat pile.
  // Only id/name leave this route; nothing else about a project is public.
  const { data: projectRows } = await supabaseAdmin.from("projects").select("id, name").eq("client_id", client.id).order("position", { ascending: true });
  const projects = (projectRows ?? []).map((p) => ({ id: p.id as string, name: p.name as string }));

  type Row = {
    id: string; project_id: string | null; title: string; due: string | null; description: string | null; status: string;
    waiting_on_client: boolean | null; client_response: { body: string; attachments: Attachment[]; submittedAt: string } | null;
    attachments: Attachment[] | null;
  };
  const cols = "id, project_id, title, due, description, status, waiting_on_client, client_response, attachments";
  // is_private tasks never reach a public page, whatever client they're filed
  // under — RLS protects them from other teammates, but this route reads with
  // the service role, so the filter has to be explicit here.
  const [{ data: waiting }, { data: responded }, { data: deepLinked }] = await Promise.all([
    supabaseAdmin.from("tasks").select(cols).eq("client_id", client.id).eq("is_private", false).eq("waiting_on_client", true),
    supabaseAdmin.from("tasks").select(cols).eq("client_id", client.id).eq("is_private", false).not("client_response", "is", null),
    // Proven to belong to this client (same eq("client_id", ...) as the two
    // queries above) before it's allowed to appear — a task id is not itself
    // a secret, so this must never trust deepLinkTaskId alone.
    deepLinkTaskId
      ? supabaseAdmin.from("tasks").select(cols).eq("client_id", client.id).eq("is_private", false).eq("id", deepLinkTaskId)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const byId = new Map<string, Row>();
  [...(waiting ?? []), ...(responded ?? []), ...(deepLinked ?? [])].forEach((t) => byId.set((t as Row).id, t as Row));
  const rows = [...byId.values()].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));

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
  type MessageRow = { id: string; task_id: string | null; direction: string; body: string; created_at: string; attachments: Attachment[] | null; created_by: string | null };
  const taskIds = rows.map((t) => t.id);
  const { data: messageRows } = taskIds.length
    ? await supabaseAdmin.from("messages").select("id, task_id, direction, body, created_at, attachments, created_by")
        .eq("client_id", client.id).in("task_id", taskIds).order("created_at", { ascending: true })
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
    ? await supabaseAdmin.from("profiles").select("member_id, name, color, avatar_url").in("member_id", senderIds)
    : { data: [] as { member_id: string; name: string; color: string; avatar_url: string | null }[] };
  const senderById = new Map((senderRows ?? []).map((p) => [p.member_id as string, {
    name: (p.name as string) || "Team", avatarUrl: (p.avatar_url as string | null) ?? null,
    color: (p.color as string) || "#1b3a5c", initials: initialsOf((p.name as string) || "Team"),
  }]));

  const tasks = await Promise.all(rows.map(async (t) => {
    const cr = t.client_response as { body: string; attachments: Attachment[]; submittedAt: string } | null;
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
        body: htmlToText(m.body ?? ""),
        at: m.created_at,
        attachments: await resolveAttachments(m.attachments ?? []),
        sender: m.direction === "outbound" && m.created_by ? senderById.get(m.created_by) ?? null : null,
      }))),
    ]);
    return {
      id: t.id, projectId: t.project_id ?? null, title: t.title, due: t.due ?? null,
      // Stripped to plain text server-side — no HTML ever reaches this public
      // response, and the page never needs the TipTap editor bundle to render it.
      description: htmlToText(t.description ?? ""),
      status: t.status, needsResponse: t.waiting_on_client === true,
      // Mockups/screenshots/staging links the team attached — the "review
      // pages, media, etc" surface, so the client sees what they're
      // approving/responding to, not just a text description.
      attachments,
      response: cr ? { body: cr.body, submittedAt: cr.submittedAt, attachments: responseAttachments } : null,
      thread,
    };
  }));

  // Playbook progress — reuses playbookCompletion()'s exact definition of
  // "next" (the main PLAYBOOK_STEPS path only, same as Cockpit.tsx's own
  // dashboard), so this page never tells a business something different from
  // what a rep sees internally about the same account. SALES_STAGE_STEPS is
  // never imported here — those are the rep's own pipeline stages, not
  // something a business should see about its own account.
  const { data: pbTaskRows } = await supabaseAdmin.from("tasks").select("playbook_step_key, status").eq("client_id", client.id).not("playbook_step_key", "is", null);
  const pbRows = (pbTaskRows ?? []) as { playbook_step_key: string; status: string }[];
  const doneKeys = new Set(pbRows.filter((t) => t.status === "done").map((t) => t.playbook_step_key));
  const existingKeys = new Set(pbRows.map((t) => t.playbook_step_key));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completion = playbookCompletion(client.id, pbRows.map((t) => ({ clientId: client.id, playbookStepKey: t.playbook_step_key, status: t.status })) as any);

  // Display order: same as Cockpit's buildPlaybookGroups — A2P/email-domain
  // spliced right after "Get on the map" ("do it early," per the source
  // docs), monthly retention at the very end. PLAYBOOK_PHASES[0] is "sales"
  // (the internal pipeline) — filtered out, never reaches this response.
  const orderedPhases = PLAYBOOK_PHASES.filter((p) => p.key !== "sales");
  const mapIdx = orderedPhases.findIndex((p) => p.key === "map");
  orderedPhases.splice(mapIdx + 1, 0, PLAYBOOK_A2P_PHASE, PLAYBOOK_EMAIL_DOMAIN_PHASE);
  orderedPhases.push(PLAYBOOK_ONGOING_PHASE);

  const stepsByPhase = new Map<string, { key: string; label: string; done: boolean }[]>();
  for (const step of PLAYBOOK_ALL_STEPS) {
    if (!existingKeys.has(step.key)) continue; // e.g. A2P steps for a client who doesn't text
    const list = stepsByPhase.get(step.phase) ?? [];
    list.push({ key: step.key, label: step.label, done: doneKeys.has(step.key) });
    stepsByPhase.set(step.phase, list);
  }
  const playbook = {
    doneCount: completion.doneCount, total: completion.total, pct: completion.pct,
    next: completion.next ? { key: completion.next.key, label: completion.next.label } : null,
    phases: orderedPhases
      .map((p) => ({ key: p.key, label: CLIENT_PHASE_LABEL[p.key] ?? p.label, steps: stepsByPhase.get(p.key) ?? [] }))
      .filter((p) => p.steps.length > 0),
  };

  // Whether this client may raise brand-new tasks here at all — the page uses
  // it to show or hide the "Add Something" composer. Not a permission the
  // page enforces: ./request/route.ts re-checks the same column before it
  // writes anything, so this is purely so the client isn't offered a button
  // that would only refuse them (see supabase/client-request-new-tasks.sql).
  return NextResponse.json({ clientName: client.name, canRequestNewTasks: client.can_request_new_tasks === true, projects, tasks, playbook, deepLinkTaskId: deepLinkTaskId || null });
}
