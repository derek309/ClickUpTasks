import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamTaskAccess } from "@/lib/taskDocumentServer";
import { suggestNextStep } from "@/lib/nextStepServer";

// POST { stepId, clientFirst }: the next step a "what's next?" step's context
// points to, worked out once and kept on the step (Derek, 2026-10-14).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { id } = await params;
  const access = await teamTaskAccess(req, id);
  if (!access.ok) return access.res;
  const body = (await req.json().catch(() => ({}))) as { stepId?: unknown; clientFirst?: unknown };
  if (typeof body.stepId !== "string") return NextResponse.json({ error: "Which step?" }, { status: 400 });
  const first = typeof body.clientFirst === "string" && body.clientFirst.trim() ? body.clientFirst.trim().slice(0, 60) : "the client";
  return NextResponse.json({ suggested: await suggestNextStep(id, body.stepId, first) });
}
