import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, memberLabel, NO_STORE } from "@/lib/taskDocumentServer";
import { startDocUpload, finishDocUpload, removeDocFile } from "@/lib/taskDocumentFiles";

// The team adds and removes files on a task's client document. The client sees a
// new file on their review page straight away; removing one takes it away too.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function open(req: NextRequest, params: Promise<{ id: string }>) {
  if (!adminConfigured) return { ok: false as const, res: json({ error: "Not configured" }, 501) };
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access;
  const { data: doc } = await supabaseAdmin.from("task_documents").select("id, approved_at").eq("task_id", id).is("deleted_at", null).maybeSingle();
  if (!doc) return { ok: false as const, res: json({ error: "This task has no client document yet." }, 404) };
  if (doc.approved_at) return { ok: false as const, res: json({ error: "This document is approved. Reopen it to change its files." }, 409) };
  const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return { ok: false as const, res: json({ error: "Invalid request." }, 400) };
  const user = access.user;
  return { ok: true as const, documentId: doc.id as string, payload, actor: { id: user.memberId ?? user.id, label: await memberLabel(user) } };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  if (o.payload.action === "start") {
    const r = await startDocUpload(o.documentId, o.payload.name, o.payload.size);
    return r.ok ? json({ path: r.path, uploadUrl: r.uploadUrl }) : json({ error: r.error }, r.status);
  }
  if (o.payload.action === "confirm") {
    const r = await finishDocUpload(o.documentId, o.payload.path, o.payload.name, o.actor);
    return r.ok ? json({ ok: true, fileId: r.fileId }) : json({ error: r.error }, r.status);
  }
  return json({ error: "Invalid request." }, 400);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await removeDocFile(o.documentId, o.payload.fileId, o.actor, false);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}
