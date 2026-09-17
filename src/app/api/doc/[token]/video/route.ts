import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken } from "@/lib/taskDocumentServer";
import { docVideoUrl } from "@/lib/taskDocumentFiles";

// Public, no login: a link the player streams one version of a video review from
// (GET ?fileId=), for a version the client was shown. The link goes straight to
// storage and lasts hours rather than minutes, because the player holds it for the
// whole watch and every seek asks storage for a byte range against it. Asking the
// app once per video, instead of once per range, also keeps watching clear of the
// read budget the poll shares (rateLimit.ts).
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501, headers: NO_STORE });
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return docNotFound();
  const limited = await rateLimit(req, token, "doc_read");
  if (limited) return limited;
  const scope = await resolveDocToken(token);
  if (!scope || scope.kind !== "video") return docNotFound();
  const url = await docVideoUrl(scope.documentId, req.nextUrl.searchParams.get("fileId"), true);
  if (!url) return docNotFound();
  return NextResponse.json({ url }, { headers: NO_STORE });
}
