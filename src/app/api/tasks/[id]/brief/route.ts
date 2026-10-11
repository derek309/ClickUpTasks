import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamActor } from "@/lib/taskDocumentServer";
import { NO_STORE, createBrief, deleteBrief, restoreBrief, saveBrief, teamBriefAccess } from "@/lib/briefServer";
import { DOC_MAX_RAW_CHARS } from "@/lib/docHtml";

// The team's side of a task's project instructions (src/lib/briefServer.ts):
// make them from a template, save them as they are typed, delete them. Reads
// happen in the browser through row level security (db.ts fetchTaskBrief).

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamBriefAccess(req, id);
  if (!access.ok) return access.res;
  const payload = await req.json().catch(() => ({})) as { template?: unknown; restore?: unknown };
  // Deleted instructions back from the task (within 30 days).
  if (typeof payload?.restore === "string") {
    const r = await restoreBrief(id, payload.restore);
    return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
  }
  const r = await createBrief(access.task, teamActor(access.user), payload?.template);
  return r.ok ? json({ brief: r.brief }) : json({ error: r.error }, r.status);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamBriefAccess(req, id);
  if (!access.ok) return access.res;
  const text = await req.text();
  if (text.length > DOC_MAX_RAW_CHARS) return json({ error: "These instructions are too long." }, 413);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(text) ?? {}; } catch { return json({ error: "Invalid request." }, 400); }
  const r = await saveBrief(id, teamActor(access.user), payload);
  return r.ok ? json({ brief: r.brief }) : json({ error: r.error }, r.status);
}

// After a confirm in the window: the link stops for good; the instructions
// and their files can be restored from the task for 30 days.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamBriefAccess(req, id);
  if (!access.ok) return access.res;
  await deleteBrief(id);
  return json({ ok: true });
}
