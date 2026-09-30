import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { BRIEF_FILE_ID, BRIEF_TOKEN_PATTERN } from "@/lib/brief";
import { NO_STORE, briefNotFound, outsideFileUrl, resolveBriefToken } from "@/lib/briefServer";

// Public, no login: open one of the team's files on the instructions. Sends the
// browser on to a five minute storage link made fresh each time. ?download=1
// saves it instead. Files sent back never open here.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501, headers: NO_STORE });
  const { token, fileId } = await params;
  if (!BRIEF_TOKEN_PATTERN.test(token) || !BRIEF_FILE_ID.test(fileId)) return briefNotFound();
  const limited = await rateLimit(req, token, "brief_read");
  if (limited) return limited;
  const scope = await resolveBriefToken(token);
  if (!scope) return briefNotFound();
  const url = await outsideFileUrl(scope.briefId, fileId, req.nextUrl.searchParams.get("download") === "1");
  if (!url) return briefNotFound();
  return NextResponse.redirect(url, { status: 302, headers: NO_STORE });
}
