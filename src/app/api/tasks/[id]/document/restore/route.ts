import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, teamActor, kindOf, NO_STORE } from "@/lib/taskDocumentServer";
import { restoreReview } from "@/lib/reviewService";

// Bring back a client document deleted from this task in the last 30 days (Derek,
// 2026-09-11: "restore them for 30 days"). Everything returns with it: the text,
// versions, saved drafts, files, comments and the same client link. ?kind=image
// and ?kind=page restore an image or HTML review. See restoreReview.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const payload = await req.json().catch(() => null) as { documentId?: unknown } | null;
  const documentId = typeof payload?.documentId === "string" ? payload.documentId : null;
  if (!documentId) return json({ error: "Invalid request." }, 400);
  const r = await restoreReview(id, kindOf(req), teamActor(access.user), documentId);
  return r.ok ? json({ document: r.document }) : json({ error: r.error }, r.status);
}
