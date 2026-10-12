import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess } from "@/lib/taskDocumentServer";
import { granolaConfigured } from "@/lib/granolaClient";
import { ensureMeetingSteps } from "@/lib/stepsServer";
import { transcriptForTask } from "@/lib/granolaSyncServer";

// POST: Client work's Add, Meeting transcript (Derek, 2026-10-12). The
// meeting's steps, then the client's Granola meeting filed on them when there
// is one. Anyone on the team who can see the task.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const { stepId } = (await req.json().catch(() => ({}))) as { stepId?: string };
  if (!granolaConfigured) { await ensureMeetingSteps(id); return NextResponse.json({ ok: true, filed: null }); }
  try {
    const r = await transcriptForTask(id, typeof stepId === "string" && stepId ? stepId : undefined);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Granola didn't answer." }, { status: 502 });
  }
}
