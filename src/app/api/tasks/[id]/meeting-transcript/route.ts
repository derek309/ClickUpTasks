import { NextRequest, NextResponse } from "next/server";
import { adminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";
import { teamDocAccess } from "@/lib/taskDocumentServer";
import { granolaAnywhere, granolaKeyFor } from "@/lib/granolaKeys";
import { requireUser } from "@/lib/serverAuth";
import { ensureMeetingSteps, stepWaitsOnTranscript } from "@/lib/stepsServer";
import { transcriptForTask } from "@/lib/granolaSyncServer";
import type { Subtask } from "@/lib/data";

// The steps as they are now and the one the transcript goes on, so the page
// can open its paste box there when Granola has nothing (Derek, 2026-10-15).
async function stepsNow(id: string, stepId?: string): Promise<{ stepId: string | null; subtasks: Subtask[] | null }> {
  const { data } = await supabaseAdmin.from("tasks").select("subtasks").eq("id", id).maybeSingle();
  const subtasks = ((data as { subtasks?: Subtask[] | null } | null)?.subtasks ?? null);
  const step = (subtasks ?? []).find((x) => (stepId ? x.id === stepId : !x.done && x.finishWhen === "transcript"));
  return { stepId: step?.id ?? null, subtasks };
}

// POST: Client work's Add, Meeting transcript (Derek, 2026-10-12). The
// meeting's steps, then the client's Granola meeting filed on them when there
// is one. Anyone on the team who can see the task.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const { stepId: rawStep } = (await req.json().catch(() => ({}))) as { stepId?: string };
  const stepId = typeof rawStep === "string" && rawStep ? rawStep : undefined;
  // Nothing found and you have no key of your own: say where to add it.
  const caller = await requireUser(req);
  const connect = !(await granolaKeyFor(caller?.id));
  if (!(await granolaAnywhere())) {
    if (stepId) await stepWaitsOnTranscript(id, stepId); else await ensureMeetingSteps(id);
    return NextResponse.json({ ok: true, filed: null, connect: true, ...(await stepsNow(id, stepId)) });
  }
  try {
    const r = await transcriptForTask(id, stepId);
    if (!r.ok) return NextResponse.json({ error: r.error, ...(await stepsNow(id, stepId)) }, { status: 400 });
    return NextResponse.json({ ...r, connect: !r.filed && connect, subtasks: (await stepsNow(id, r.stepId)).subtasks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Granola didn't answer.", ...(await stepsNow(id, stepId)) }, { status: 502 });
  }
}
