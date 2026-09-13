import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken, readPublicJson, clientPublish } from "@/lib/taskDocumentServer";

// Shared by the client's two writes, submit and approve, so the checks they must
// both make can never drift apart. In order: token format, rate limit (before
// any lookup), a JSON body from this site within the size cap, the link still
// resolving, then the publish itself. A web page review also sends the page file
// the client looked at and their rewording.
export async function publishFromClient(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
  kind: "client_submitted" | "client_approved",
): Promise<NextResponse> {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501, headers: NO_STORE });
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return docNotFound();
  const limited = await rateLimit(req, token, kind === "client_approved" ? "doc_approve" : "doc_submit");
  if (limited) return limited;

  const read = await readPublicJson(req);
  if (!read.ok) return read.res;
  const scope = await resolveDocToken(token);
  if (!scope) return docNotFound();

  const { html, baseVersion, fileId, edits } = read.body;
  const outcome = await clientPublish(scope, kind, html, baseVersion, { fileId, edits });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, current: outcome.current ?? null }, { status: outcome.status, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, version: outcome.version }, { headers: NO_STORE });
}
