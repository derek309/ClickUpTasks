import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, NO_STORE } from "@/lib/taskDocumentServer";

// Bring back a client document deleted from this task in the last 30 days (Derek,
// 2026-09-11: "restore them for 30 days"). Everything returns with it: the text,
// versions, saved drafts, files, comments and the same client link. A task has
// one live document, so a restore waits until the current one is deleted.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const RETENTION_DAYS = 30;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const payload = await req.json().catch(() => null) as { documentId?: unknown } | null;
  const documentId = typeof payload?.documentId === "string" ? payload.documentId : null;
  if (!documentId) return json({ error: "Invalid request." }, 400);

  const { data: live } = await supabaseAdmin.from("task_documents").select("id").eq("task_id", id).is("deleted_at", null).maybeSingle();
  if (live) return json({ error: "This task already has a document. Delete that one first, then restore this one." }, 409);

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("task_documents")
    .update({ deleted_at: null, deleted_by: null, updated_by: access.user.memberId, updated_at: now })
    .eq("id", documentId).eq("task_id", id).gt("deleted_at", cutoff)
    .select("*").maybeSingle();
  // A document restored or made at the same moment trips the one live document rule.
  if (error) return json({ error: "This task already has a document. Delete that one first, then restore this one." }, 409);
  if (!data) return json({ error: "That document can no longer be restored." }, 404);
  return json({ document: data });
}
