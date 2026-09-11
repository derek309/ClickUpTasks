import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken, latestPublished } from "@/lib/taskDocumentServer";
import { sharedDocFiles } from "@/lib/taskDocumentFiles";

// Public, no login: what the client review page shows. It reads and never
// writes. Mail security scanners (Outlook Safe Links and others) open links
// before the client does, so opening the link must change nothing.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501, headers: NO_STORE });
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return docNotFound();
  // rateLimit() keys by the token's hash, so a raw link never lands in the counter table.
  const limited = await rateLimit(req, token, "doc_read");
  if (limited) return limited;

  const scope = await resolveDocToken(token);
  if (!scope) return docNotFound();
  const [latest, { data: doc }, files] = await Promise.all([
    latestPublished(scope.documentId),
    supabaseAdmin.from("task_documents").select("status, approved_at, title").eq("id", scope.documentId).maybeSingle(),
    sharedDocFiles(scope.documentId),
  ]);
  if (!latest || !doc) return docNotFound();

  return NextResponse.json({
    // The document's own name when the team gave it one, else the task's title.
    title: ((doc.title as string | null) ?? "").trim() || scope.taskTitle,
    clientName: scope.clientName,
    body: latest.body,
    version: latest.version,
    status: doc.status,
    approvedAt: (doc.approved_at as string | null) ?? null,
    closed: scope.taskStatus === "done",
    files,
  }, { headers: NO_STORE });
}
