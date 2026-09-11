import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import {
  DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken, readPublicJson, logClientDocEvent, notifyOwnerOfClientDoc,
  type DocScope,
} from "@/lib/taskDocumentServer";
import { postDocComment, editDocComment, deleteDocComment } from "@/lib/taskDocumentFiles";

// Public, no login: the client's side of the comment thread. They post, edit and
// delete their own comments, and tick any comment done. A new comment is logged on
// the task so the team sees it live, and the task owner is told (at most one email
// every 15 minutes per document, the same cooldown as sent changes).

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function open(req: NextRequest, params: Promise<{ token: string }>): Promise<
  { ok: true; scope: DocScope; payload: Record<string, unknown> } | { ok: false; res: NextResponse }
> {
  if (!adminConfigured) return { ok: false, res: json({ error: "Not configured" }, 501) };
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return { ok: false, res: docNotFound() };
  const limited = await rateLimit(req, token, "doc_comment");
  if (limited) return { ok: false, res: limited };
  const read = await readPublicJson(req);
  if (!read.ok) return read;
  const scope = await resolveDocToken(token);
  if (!scope) return { ok: false, res: docNotFound() };
  if (scope.taskStatus === "done" || scope.documentStatus === "completed") return { ok: false, res: json({ error: "This document is closed." }, 409) };
  return { ok: true, scope, payload: read.body };
}

const clientActor = (scope: DocScope) => ({ id: null, label: scope.clientName });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const { scope } = o;
  const r = await postDocComment(scope.documentId, o.payload.body, clientActor(scope));
  if (!r.ok) return json({ error: r.error }, r.status);

  const snippet = r.comment.body.length > 140 ? `${r.comment.body.slice(0, 140)}…` : r.comment.body;
  await logClientDocEvent(scope.taskId, `${scope.clientName} commented on the client document: "${snippet}"`);
  await notifyOwnerOfClientDoc(scope, {
    always: false,
    text: `${scope.clientName} commented on the client document on "${scope.taskTitle}".`,
    subject: `${scope.clientName} commented on "${scope.taskTitle}"`,
  });
  return json({ comment: r.comment });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await editDocComment(o.scope.documentId, o.payload.commentId, { body: o.payload.body, done: o.payload.done }, clientActor(o.scope));
  return r.ok ? json({ comment: r.comment }) : json({ error: r.error }, r.status);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await deleteDocComment(o.scope.documentId, o.payload.commentId, clientActor(o.scope), false);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}
