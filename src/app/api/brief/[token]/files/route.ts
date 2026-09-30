import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { readPublicJson } from "@/lib/taskDocumentServer";
import { BRIEF_TOKEN_PATTERN } from "@/lib/brief";
import { NO_STORE, briefNotFound, finishBriefUpload, noteOutsideFile, outsideName, resolveBriefToken, startBriefUpload } from "@/lib/briefServer";

// Public, no login: the outside person sends a file back. Straight to storage
// through a one time upload link, then confirmed here, where its real size and
// type are checked. It lands on the task for the team; nothing reaches the client.
// They cannot remove files, see who else sent some, or open them again.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { token } = await params;
  if (!BRIEF_TOKEN_PATTERN.test(token)) return briefNotFound();
  const limited = await rateLimit(req, token, "brief_upload");
  if (limited) return limited;
  const read = await readPublicJson(req);
  if (!read.ok) return read.res;
  const scope = await resolveBriefToken(token);
  if (!scope) return briefNotFound();
  if (!scope.uploadsOpen) return json({ error: "Sending files here is switched off. Send them the way you were asked to." }, 409);
  const payload = read.body;
  if (payload.action === "start") {
    const r = await startBriefUpload(scope.briefId, payload.name, payload.size, true);
    return r.ok ? json({ path: r.path, uploadUrl: r.uploadUrl }) : json({ error: r.error }, r.status);
  }
  if (payload.action === "confirm") {
    const who = outsideName(payload.from);
    const r = await finishBriefUpload(scope.briefId, payload.path, payload.name, { id: null, label: who }, true);
    if (!r.ok) return json({ error: r.error }, r.status);
    await noteOutsideFile(scope, who, r.name);
    return json({ ok: true, fileId: r.fileId });
  }
  return json({ error: "Invalid request." }, 400);
}
