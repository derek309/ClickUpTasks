import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken } from "@/lib/taskDocumentServer";
import { sharedDocFileUrl } from "@/lib/taskDocumentFiles";

// Public, no login: open one file on the document. Sends the browser on to a
// storage link that lasts five minutes, made fresh each time, so the page never
// holds links that expire under it. ?download=1 saves the file instead.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501, headers: NO_STORE });
  const { token, fileId } = await params;
  if (!DOC_TOKEN_PATTERN.test(token) || !/^tdf_[0-9a-f-]{36}$/.test(fileId)) return docNotFound();
  const limited = await rateLimit(req, token, "doc_read");
  if (limited) return limited;
  const scope = await resolveDocToken(token);
  if (!scope) return docNotFound();
  const url = await sharedDocFileUrl(scope.documentId, fileId, req.nextUrl.searchParams.get("download") === "1");
  if (!url) return docNotFound();
  return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
}
