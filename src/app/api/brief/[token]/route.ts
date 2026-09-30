import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { BRIEF_TOKEN_PATTERN } from "@/lib/brief";
import { NO_STORE, briefFiles, briefNotFound, outsideTitle, resolveBriefToken } from "@/lib/briefServer";

// Public, no login: what the outside person's page shows. It reads and never
// writes, since link scanners open links first. Only the instructions, the
// team's files, the business name when the team left that on, and the names of
// files already sent back. Never the client's contact, the task, or its other work.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501, headers: NO_STORE });
  const { token } = await params;
  if (!BRIEF_TOKEN_PATTERN.test(token)) return briefNotFound();
  const limited = await rateLimit(req, token, "brief_read");
  if (limited) return limited;
  const scope = await resolveBriefToken(token);
  if (!scope) return briefNotFound();
  const [files, sent] = await Promise.all([briefFiles(scope.briefId, false), briefFiles(scope.briefId, true, scope.linkCreatedAt)]);
  return NextResponse.json({
    title: outsideTitle(scope),
    business: scope.showBusiness ? scope.clientName : null,
    body: scope.body,
    dueOn: scope.dueOn,
    uploadsOpen: scope.uploadsOpen,
    files,
    sent: sent.map((f) => ({ id: f.id, name: f.name, size: f.size, addedBy: f.addedBy, createdAt: f.createdAt })),
  }, { headers: NO_STORE });
}
