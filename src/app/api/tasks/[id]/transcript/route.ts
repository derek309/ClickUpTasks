import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { adminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";
import { teamDocAccess } from "@/lib/taskDocumentServer";
import { fileTextTranscript } from "@/lib/granolaSyncServer";
import { stepsOnMeetingTranscript } from "@/lib/stepsServer";
import { checkTranscriptSave, transcriptFileName } from "@/lib/transcriptPaste";
import { todayPacific, type Subtask } from "@/lib/data";

// POST: a meeting's transcript added by hand (Derek, 2026-10-15: "If it can't
// find the Granola transcript, how can I add it manually?"). Pasted text is
// filed exactly as Granola's is (fileTextTranscript): a text file held on the
// step, which is done. A file already uploaded to the task is held the same
// way. A recording's link becomes a link named "Recording" on the step.
// Anyone on the team who can see the task, as for Granola's.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const checked = checkTranscriptSave(await req.json().catch(() => null));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const v = checked.value;
  const { data: row } = await supabaseAdmin.from("tasks").select("title, subtasks").eq("id", id).maybeSingle();
  const steps = ((row as { subtasks?: Subtask[] | null } | null)?.subtasks ?? []);
  const step = steps.find((x) => x.id === v.stepId);
  if (!step) return NextResponse.json({ error: "That step is gone. Open the task again." }, { status: 404 });
  try {
    const also: string[] = [];
    if (v.link) {
      const link = { id: "a_" + randomUUID().slice(0, 12), name: "Recording", kind: "link", size: "", url: v.link };
      const { error } = await supabaseAdmin.rpc("append_task_attachments", { task_id: id, items: [link] });
      if (error) throw new Error(`The recording link didn't save: ${error.message}`);
      also.push(link.id);
    }
    let filed: string;
    if (v.text) {
      const name = transcriptFileName(v.name || step.title || String((row as { title?: string } | null)?.title ?? ""), todayPacific());
      filed = await fileTextTranscript(id, { name, body: v.text, stepId: step.id, alsoHold: also, outcome: "Transcript added" });
    } else {
      await stepsOnMeetingTranscript(id, [v.attachmentId!, ...also], step.id, "Transcript added");
      filed = "the transcript";
    }
    const { data: after } = await supabaseAdmin.from("tasks").select("subtasks").eq("id", id).maybeSingle();
    return NextResponse.json({ ok: true, filed, subtasks: (after as { subtasks?: Subtask[] | null } | null)?.subtasks ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't save the transcript." }, { status: 500 });
  }
}
