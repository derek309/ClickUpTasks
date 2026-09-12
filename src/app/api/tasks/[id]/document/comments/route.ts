import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, memberLabel, NO_STORE } from "@/lib/taskDocumentServer";
import { postDocComment, editDocComment, deleteDocComment } from "@/lib/taskDocumentFiles";
import { emailClientAboutComment } from "@/lib/docClientEmail";

// The team's side of the comment thread on a task's client document: post, edit
// your own, tick any comment done, delete any. The thread is shared, so the client
// sees changes the next time their page refreshes. The team reads the thread
// through row level security (db.ts).

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function open(req: NextRequest, params: Promise<{ id: string }>) {
  if (!adminConfigured) return { ok: false as const, res: json({ error: "Not configured" }, 501) };
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access;
  const { data: doc } = await supabaseAdmin.from("task_documents").select("id").eq("task_id", id).is("deleted_at", null).maybeSingle();
  if (!doc) return { ok: false as const, res: json({ error: "This task has no client document yet." }, 404) };
  const payload = (await req.json().catch(() => null) ?? {}) as { body?: unknown; commentId?: unknown; done?: unknown };
  const user = access.user;
  return { ok: true as const, documentId: doc.id as string, payload, user, task: access.task, actor: { id: user.memberId ?? user.id, label: await memberLabel(user) } };
}

// A new comment also emails the client a link to it (docClientEmail.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await postDocComment(o.documentId, o.payload.body, o.actor);
  if (!r.ok) return json({ error: r.error }, r.status);
  const emailedClient = await emailClientAboutComment({
    user: o.user, task: o.task, documentId: o.documentId, comment: typeof o.payload.body === "string" ? o.payload.body : "", origin: req.nextUrl.origin,
  }).catch(() => false);
  return json({ comment: r.comment, emailedClient });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await editDocComment(o.documentId, o.payload.commentId, { body: o.payload.body, done: o.payload.done }, o.actor);
  return r.ok ? json({ comment: r.comment }) : json({ error: r.error }, r.status);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await deleteDocComment(o.documentId, o.payload.commentId, o.actor, true);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}
