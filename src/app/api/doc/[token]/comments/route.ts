import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import {
  DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken, readPublicJson, logClientDocEvent, notifyOwnerOfClientDoc,
} from "@/lib/taskDocumentServer";
import { postDocComment } from "@/lib/taskDocumentFiles";

// Public, no login: the client comments on the document. It is logged on the task
// so the team sees it live, and the task owner is told (at most one email every
// 15 minutes per document, the same cooldown as sent changes).

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return docNotFound();
  const limited = await rateLimit(req, token, "doc_comment");
  if (limited) return limited;
  const read = await readPublicJson(req);
  if (!read.ok) return read.res;
  const scope = await resolveDocToken(token);
  if (!scope) return docNotFound();
  if (scope.taskStatus === "done") return json({ error: "This document is closed." }, 409);

  const r = await postDocComment(scope.documentId, read.body.body, { id: null, label: scope.clientName });
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
