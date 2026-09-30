import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamActor } from "@/lib/taskDocumentServer";
import { NO_STORE, moveToImageReview, teamBrief } from "@/lib/briefServer";

// { fileIds } Puts images sent back on the project instructions into the task's
// image review as the version to send next. Nothing reaches the client until the
// team presses Send there.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await teamBrief(req, id);
  if (!found.ok) return found.res;
  const payload = await req.json().catch(() => null) as { fileIds?: unknown } | null;
  const r = await moveToImageReview(found.task, found.brief.id as string, payload?.fileIds, teamActor(found.user));
  return r.ok ? json({ document: r.document, moved: r.moved }) : json({ error: r.error }, r.status);
}
