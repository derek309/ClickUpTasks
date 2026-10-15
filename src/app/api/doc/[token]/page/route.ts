import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken } from "@/lib/taskDocumentServer";
import { docVersionFile, readPageFile } from "@/lib/taskDocumentFiles";
import { pageText } from "@/lib/pageHtml";
import { mintFrameTicket } from "@/lib/pageFrameTicket";

// Public, no login: a frame link for one version of a web page review the client
// was shown (GET ?fileId=). Only the short lived ticket goes into the frame's
// address, never this document link: the page's own scripts can read their address.
// GET ?fileId=&as=text gives a version's words instead, so version 2 can show the
// client what changed since they last looked.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501, headers: NO_STORE });
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return docNotFound();
  const limited = await rateLimit(req, token, "doc_read");
  if (limited) return limited;
  const scope = await resolveDocToken(token);
  if (!scope || scope.kind !== "page") return docNotFound();
  if (req.nextUrl.searchParams.get("as") === "text") {
    const html = await readPageFile(scope.documentId, req.nextUrl.searchParams.get("fileId"), true);
    return html === null ? docNotFound() : NextResponse.json({ text: pageText(html) }, { headers: NO_STORE });
  }
  const file = await docVersionFile(scope.documentId, req.nextUrl.searchParams.get("fileId"), "page", true);
  if (!file) return docNotFound();
  const ticket = mintFrameTicket(scope.documentId, file.id);
  if (!ticket) return NextResponse.json({ error: "Not configured" }, { status: 501, headers: NO_STORE });
  return NextResponse.json({ frameUrl: `/page-frame/${ticket}` }, { headers: NO_STORE });
}
