import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { memberLabel } from "@/lib/taskDocumentServer";
import { NO_STORE, finishBriefUpload, removeBriefFile, startBriefUpload, teamBrief } from "@/lib/briefServer";

// The team adds files that go with the project instructions (the outside page
// lists them to download), or takes any file off, one sent back included.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function open(req: NextRequest, params: Promise<{ id: string }>) {
  if (!adminConfigured) return { ok: false as const, res: json({ error: "Not configured" }, 501) };
  const { id } = await params;
  const found = await teamBrief(req, id);
  if (!found.ok) return found;
  const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return { ok: false as const, res: json({ error: "Invalid request." }, 400) };
  return { ok: true as const, briefId: found.brief.id as string, payload, actor: { id: found.user.memberId ?? found.user.id, label: await memberLabel(found.user) } };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  if (o.payload.action === "start") {
    const r = await startBriefUpload(o.briefId, o.payload.name, o.payload.size, false);
    return r.ok ? json({ path: r.path, uploadUrl: r.uploadUrl }) : json({ error: r.error }, r.status);
  }
  if (o.payload.action === "confirm") {
    const r = await finishBriefUpload(o.briefId, o.payload.path, o.payload.name, o.actor, false);
    return r.ok ? json({ ok: true, fileId: r.fileId }) : json({ error: r.error }, r.status);
  }
  return json({ error: "Invalid request." }, 400);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await removeBriefFile(o.briefId, o.payload.fileId);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}
