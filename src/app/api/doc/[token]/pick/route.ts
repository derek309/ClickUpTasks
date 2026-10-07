import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken, readPublicJson } from "@/lib/taskDocumentServer";
import { sharedVersionFiles } from "@/lib/taskDocumentFiles";
import { isFileKind } from "@/lib/reviewKinds";
import { parseImageSet } from "@/lib/imageSet";
import { resolveNotifyRecipient } from "@/lib/waitingNotify";

// Public, no login: the client chooses one of the options a version holds, like
// one of three emails (Derek, 2026-10-07: "make it clear for the client to
// choose"). The others are not picked. The team's bell says which, and the
// review window shows it. { fileId } chooses, { fileId: null } takes it back.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return docNotFound();
  const limited = await rateLimit(req, token, "doc_pick");
  if (limited) return limited;
  const read = await readPublicJson(req);
  if (!read.ok) return read.res;
  const scope = await resolveDocToken(token);
  if (!scope || !isFileKind(scope.kind)) return docNotFound();

  const raw = (read.body as { fileId?: unknown } | null)?.fileId;
  const fileId = typeof raw === "string" && raw ? raw : null;
  // Only one of the options the client is actually shown: the newest version sent.
  const items = parseImageSet((await sharedVersionFiles(scope.documentId)).at(-1)?.body ?? "");
  const item = fileId ? items.find((x) => x.file === fileId) : null;
  if (fileId && !item) return json({ error: "That option is not on this review." }, 400);

  const { error } = await supabaseAdmin.from("task_documents")
    .update({ picks: item ? { fileId: item.file, by: "client", at: new Date().toISOString() } : {}, updated_by: null })
    .eq("id", scope.documentId);
  if (error) return json({ error: error.message }, 400);

  if (item) {
    const label = item.label || `Option ${String.fromCharCode(65 + items.indexOf(item))}`;
    const recipient = scope.assigneeId ?? await resolveNotifyRecipient(scope.assignedTo);
    if (recipient) {
      await supabaseAdmin.from("notifications").insert({
        id: "n_" + randomUUID(), recipient_id: recipient,
        text: `${scope.clientName} chose "${label}" on "${scope.reviewName}".`,
        task_id: scope.taskId, actor_id: null, client_id: scope.clientId, project_id: scope.projectId,
        at: new Date().toISOString(), read: false, kind: "activity",
      });
    }
  }
  return json({ ok: true, pick: item?.file ?? null });
}
