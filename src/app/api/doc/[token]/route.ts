import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken, latestPublished, latestSentAt } from "@/lib/taskDocumentServer";
import { sharedDocFiles, sharedVersionFiles, docComments, type SharedVersionFile } from "@/lib/taskDocumentFiles";
import { isFileKind } from "@/lib/reviewKinds";

// Public, no login: what the client review page shows. It reads and never
// writes. Mail security scanners (Outlook Safe Links and others) open links
// before the client does, so opening the link must change nothing.
// For an image or web page review, body is the version under review (a file id, or
// an image set, imageSet.ts) and versionFiles lists every version the client can
// still see, oldest first, with its images.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501, headers: NO_STORE });
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return docNotFound();
  // rateLimit() keys by the token's hash, so a raw link never lands in the counter table.
  const limited = await rateLimit(req, token, "doc_read");
  if (limited) return limited;

  const scope = await resolveDocToken(token);
  if (!scope) return docNotFound();
  const [latest, { data: doc }, files, comments, versionFiles, sharedAt] = await Promise.all([
    latestPublished(scope.documentId, scope.kind),
    supabaseAdmin.from("task_documents").select("status, approved_at, approved_by, title").eq("id", scope.documentId).maybeSingle(),
    sharedDocFiles(scope.documentId),
    docComments(scope.documentId),
    isFileKind(scope.kind) ? sharedVersionFiles(scope.documentId) : Promise.resolve<SharedVersionFile[]>([]),
    latestSentAt(scope.documentId),
  ]);
  if (!latest || !doc) return docNotFound();

  return NextResponse.json({
    kind: scope.kind,
    // The document's own name when the team gave it one, else the task's title.
    title: ((doc.title as string | null) ?? "").trim() || scope.taskTitle,
    clientName: scope.clientName,
    // An image or page review shows the newest version file not removed; "" when none is left.
    body: isFileKind(scope.kind) ? (versionFiles.at(-1)?.body ?? "") : latest.body,
    version: latest.version,
    status: doc.status,
    approvedAt: (doc.approved_at as string | null) ?? null,
    // Whether the team closed this out rather than the client clicking Approve, so
    // the page never thanks someone for something they did not do. The name is not
    // sent, only the fact: who on the team did it is the team's business.
    approvedByTeam: doc.approved_by != null,
    closed: scope.taskStatus === "done" || doc.status === "completed",
    files,
    comments,
    versionFiles,
    // When the team last sent a version: the client's comments count as changes from here on (reviewChanges.ts).
    sharedAt,
  }, { headers: NO_STORE });
}
