import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken, type AuthedUser } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";
import { randomUUID } from "crypto";

// Work contexts for the Clipper: the tabs a teammate keeps open for a client,
// and optionally for one task under it. See supabase/work-contexts.sql for
// the shape and why it's stored here rather than in the extension.
//
// task_id null is the client's baseline. GET returns the baseline and the
// task's own set separately AND pre-layered, so the panel can both open the
// right thing and show which tabs are inherited rather than task-specific.

const HARD_MAX_TABS = 60;
const MAX_URL_CHARS = 2000;

type TabRow = { url: string; title: string; pinned: boolean };

/** Same preamble every extension route uses, plus the task-belongs-to-client
 *  check. Without that last part a token could attach tabs to a task sitting
 *  under a client it isn't allowed to see. */
async function gate(req: NextRequest, clientId: string | null, taskId: string | null): Promise<{ caller: AuthedUser } | NextResponse> {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!caller.memberId) return NextResponse.json({ error: "This token's account has no roster member id." }, { status: 403 });
  if (!clientId) return NextResponse.json({ error: "Missing client_id." }, { status: 400 });
  if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });
  if (taskId) {
    const { data: task } = await supabaseAdmin.from("tasks").select("client_id").eq("id", taskId).maybeSingle();
    if (!task) return NextResponse.json({ error: "Unknown task." }, { status: 404 });
    if (task.client_id !== clientId) return NextResponse.json({ error: "That task doesn't belong to this client." }, { status: 400 });
  }
  return { caller };
}

function sanitizeTabs(input: unknown): TabRow[] | string {
  if (!Array.isArray(input)) return "tabs must be an array.";
  if (input.length > HARD_MAX_TABS) return `That's ${input.length} tabs. The limit is ${HARD_MAX_TABS} — split it into a task-level set.`;
  const out: TabRow[] = [];
  for (const raw of input) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const url = typeof t.url === "string" ? t.url.trim() : "";
    if (!url) continue;
    if (url.length > MAX_URL_CHARS) return "One of those URLs is too long to store.";
    // Mirrors isCapturable in chrome-extension/lib/context.js — anything that
    // can't be reopened on another day has no business being saved.
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({ url, title: typeof t.title === "string" ? t.title.slice(0, 300) : "", pinned: t.pinned === true });
  }
  return out;
}

/** Baseline first, then whatever the task adds that isn't already there.
 *  Kept in step with layerContexts in chrome-extension/lib/context.js; the
 *  server does it too so a caller can't be handed a half-layered list. */
function layer(baseline: TabRow[], taskTabs: TabRow[]): TabRow[] {
  const seen = new Set<string>();
  const key = (u: string) => { try { const p = new URL(u); return `${p.protocol}//${p.host}${p.pathname.replace(/\/+$/, "")}`.toLowerCase(); } catch { return u.trim().toLowerCase(); } };
  const out: TabRow[] = [];
  for (const t of [...baseline, ...taskTabs]) {
    const k = key(t.url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  const taskId = req.nextUrl.searchParams.get("task_id");
  const gated = await gate(req, clientId, taskId);
  if (gated instanceof NextResponse) return gated;

  const { data: rows, error } = await supabaseAdmin
    .from("work_contexts")
    .select("task_id, tabs, updated_at, last_opened_at")
    .eq("owner_member_id", gated.caller.memberId!)
    .eq("client_id", clientId!);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const baseline = (rows ?? []).find((r) => r.task_id === null)?.tabs as TabRow[] | undefined;
  const taskRow = taskId ? (rows ?? []).find((r) => r.task_id === taskId) : undefined;
  const taskTabs = taskRow?.tabs as TabRow[] | undefined;
  return NextResponse.json({
    clientTabs: baseline ?? [],
    taskTabs: taskTabs ?? [],
    tabs: layer(baseline ?? [], taskId ? (taskTabs ?? []) : []),
    updatedAt: (taskId ? taskRow : (rows ?? []).find((r) => r.task_id === null))?.updated_at ?? null,
  });
}

export async function PUT(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const clientId = typeof b.client_id === "string" ? b.client_id : null;
  const taskId = typeof b.task_id === "string" && b.task_id ? b.task_id : null;
  const gated = await gate(req, clientId, taskId);
  if (gated instanceof NextResponse) return gated;

  const tabs = sanitizeTabs(b.tabs);
  if (typeof tabs === "string") return NextResponse.json({ error: tabs }, { status: 400 });

  // Hand-rolled find-then-write rather than upsert(): the uniqueness rule is a
  // partial expression index over coalesce(task_id, ''), which Postgres won't
  // accept as an ON CONFLICT target.
  let findQ = supabaseAdmin
    .from("work_contexts").select("id")
    .eq("owner_member_id", gated.caller.memberId!)
    .eq("client_id", clientId!);
  findQ = taskId ? findQ.eq("task_id", taskId) : findQ.is("task_id", null);
  const { data: existing } = await findQ.maybeSingle();

  const row = {
    owner_member_id: gated.caller.memberId!,
    client_id: clientId!,
    task_id: taskId,
    label: typeof b.label === "string" ? b.label.slice(0, 120) : "",
    group_color: typeof b.group_color === "string" ? b.group_color.slice(0, 20) : "blue",
    tabs,
    updated_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await supabaseAdmin.from("work_contexts").update(row).eq("id", existing.id)
    : await supabaseAdmin.from("work_contexts").insert({ id: "wc_" + randomUUID(), ...row });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, count: tabs.length });
}

export async function DELETE(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");
  const taskId = req.nextUrl.searchParams.get("task_id");
  const gated = await gate(req, clientId, taskId);
  if (gated instanceof NextResponse) return gated;

  let q = supabaseAdmin.from("work_contexts").delete()
    .eq("owner_member_id", gated.caller.memberId!).eq("client_id", clientId!);
  q = taskId ? q.eq("task_id", taskId) : q.is("task_id", null);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
