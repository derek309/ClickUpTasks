import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import {
  DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken, readPublicJson, logClientDocEvent,
} from "@/lib/taskDocumentServer";
import { startDocUpload, finishDocUpload, removeDocFile } from "@/lib/taskDocumentFiles";

// Public, no login: the client adds a file to the document or removes one they
// added. A client's file is shared as soon as it is in, and each one is logged on
// the task so the team sees it live.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function open(req: NextRequest, params: Promise<{ token: string }>) {
  if (!adminConfigured) return { ok: false as const, res: json({ error: "Not configured" }, 501) };
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return { ok: false as const, res: docNotFound() };
  const limited = await rateLimit(req, token, "doc_upload");
  if (limited) return { ok: false as const, res: limited };
  const read = await readPublicJson(req);
  if (!read.ok) return read;
  const scope = await resolveDocToken(token);
  if (!scope) return { ok: false as const, res: docNotFound() };
  const { data: doc } = await supabaseAdmin.from("task_documents").select("approved_at").eq("id", scope.documentId).maybeSingle();
  if (!doc) return { ok: false as const, res: docNotFound() };
  if (doc.approved_at || scope.taskStatus === "done") return { ok: false as const, res: json({ error: "This document is closed." }, 409) };
  return { ok: true as const, scope, payload: read.body, actor: { id: null, label: scope.clientName } };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  if (o.payload.action === "start") {
    const r = await startDocUpload(o.scope.documentId, o.payload.name, o.payload.size);
    return r.ok ? json({ path: r.path, uploadUrl: r.uploadUrl }) : json({ error: r.error }, r.status);
  }
  if (o.payload.action === "confirm") {
    const r = await finishDocUpload(o.scope.documentId, o.payload.path, o.payload.name, o.actor, true);
    if (!r.ok) return json({ error: r.error }, r.status);
    await logClientDocEvent(o.scope.taskId, `${o.scope.clientName} added ${r.name} to the client document`);
    return json({ ok: true, fileId: r.fileId });
  }
  return json({ error: "Invalid request." }, 400);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await removeDocFile(o.scope.documentId, o.payload.fileId, o.actor, true);
  if (!r.ok) return json({ error: r.error }, r.status);
  await logClientDocEvent(o.scope.taskId, `${o.scope.clientName} removed ${r.name} from the client document`);
  return json({ ok: true });
}
