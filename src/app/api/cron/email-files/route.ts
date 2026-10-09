import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { copyEmailFilesToTask } from "@/lib/emailFilesServer";

// Files from emails filed on a task go onto the task's Links and files
// (Derek, 2026-10-09). Every 5 minutes (vercel.json), on its own, so the
// Gmail check stays quick. Looks at the last 6 hours; a file already on the
// task is skipped, so going over the same email again costs one read.
// Sending from the Inbox and linking a conversation still copy right away.

export const maxDuration = 60;
const WINDOW_MS = 6 * 60 * 60 * 1000;
const BUDGET_MS = 40_000;

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const { data, error } = await supabaseAdmin.from("messages").select("id, task_id")
    .not("task_id", "is", null).neq("attachments", "[]").eq("channel", "email")
    .gte("created_at", new Date(started - WINDOW_MS).toISOString())
    .order("created_at", { ascending: true }).limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let looked = 0, added = 0;
  for (const m of data ?? []) {
    if (Date.now() - started > BUDGET_MS) break;
    looked++;
    try { added += (await copyEmailFilesToTask(supabaseAdmin, m.id as string, m.task_id as string)).added.length; }
    catch (e) { console.error("[cron/email-files]", m.id, e instanceof Error ? e.message : e); }
  }
  const out = { ok: true, emails: data?.length ?? 0, looked, added };
  console.log("[cron/email-files]", JSON.stringify(out));
  return NextResponse.json(out);
}
