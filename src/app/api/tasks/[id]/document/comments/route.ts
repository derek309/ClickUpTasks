import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocument, memberLabel, NO_STORE } from "@/lib/taskDocumentServer";
import { postDocComment, editDocComment, deleteDocComment } from "@/lib/taskDocumentFiles";
import { emailClientAboutComment } from "@/lib/docClientEmail";

// The team's side of the comment thread on a task's client document: post, edit
// your own, tick any comment done, delete any. The thread is shared, so the client
// sees changes the next time their page refreshes. The team reads the thread
// through row level security (db.ts). On an image review a comment can sit on a
// numbered pin, and any comment can carry a file.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function open(req: NextRequest, params: Promise<{ id: string }>) {
  if (!adminConfigured) return { ok: false as const, res: json({ error: "Not configured" }, 501) };
  const { id } = await params;
  const found = await teamDocument(req, id);
  if (!found.ok) return found;
  const payload = (await req.json().catch(() => null) ?? {}) as { body?: unknown; commentId?: unknown; done?: unknown; quote?: unknown; pin?: unknown; attachmentFileId?: unknown };
  const user = found.user;
  return { ok: true as const, documentId: found.doc.id, payload, user, task: found.task, actor: { id: user.memberId ?? user.id, label: await memberLabel(user) } };
}

// A new comment also emails the client a link to it (docClientEmail.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await postDocComment(o.documentId, o.payload.body, o.actor, { quote: o.payload.quote, pin: o.payload.pin, attachmentFileId: o.payload.attachmentFileId });
  if (!r.ok) return json({ error: r.error }, r.status);
  const emailedClient = await emailClientAboutComment({
    user: o.user, task: o.task, documentId: o.documentId, comment: r.comment.body || "Added a file.",
    quote: r.comment.quote, pinNumber: r.comment.pin?.number ?? null, origin: req.nextUrl.origin,
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
