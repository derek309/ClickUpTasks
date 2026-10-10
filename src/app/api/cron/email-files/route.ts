import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { copyEmailFilesToTask } from "@/lib/emailFilesServer";

// Files from emails filed on a task go onto the task's Links and files,
// and onto every other task the conversation is linked to,
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
  // Newest first, each email once (messages.files_copied_at,
  // supabase/messages-files-copied.sql). Without that column yet, the old
  // read of the whole window.
  const base = () => supabaseAdmin.from("messages").select("id, task_id, gmail_thread_id, ghl_conversation_id")
    .not("task_id", "is", null).neq("attachments", "[]").eq("channel", "email")
    .gte("created_at", new Date(started - WINDOW_MS).toISOString())
    .order("created_at", { ascending: false }).limit(40);
  let marked = true;
  let { data, error } = await base().is("files_copied_at", null);
  if (error && /files_copied_at/.test(error.message)) { marked = false; ({ data, error } = await base()); }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // A conversation linked to more than one task (inbox_task_links) sends its
  // files to each of them, not only the one the email was filed on.
  const keyOf = (m: { gmail_thread_id: string | null; ghl_conversation_id: string | null }) =>
    m.gmail_thread_id ? `gm:${m.gmail_thread_id}` : m.ghl_conversation_id ? `ghl:${m.ghl_conversation_id}` : null;
  const keys = [...new Set((data ?? []).map(keyOf).filter((k): k is string => !!k))];
  const { data: links } = keys.length
    ? await supabaseAdmin.from("inbox_task_links").select("thread_key, task_id").in("thread_key", keys)
    : { data: [] as { thread_key: string; task_id: string }[] };
  let looked = 0, added = 0;
  for (const m of data ?? []) {
    if (Date.now() - started > BUDGET_MS) break;
    looked++;
    const k = keyOf(m);
    const taskIds = [...new Set([m.task_id as string, ...(links ?? []).filter((l) => l.thread_key === k).map((l) => l.task_id as string)])];
    let done = true;
    for (const taskId of taskIds) {
      try {
        const r = await copyEmailFilesToTask(supabaseAdmin, m.id as string, taskId, started + BUDGET_MS);
        added += r.added.length;
        if (r.unfinished) done = false;
      } catch (e) { done = false; console.error("[cron/email-files]", m.id, taskId, e instanceof Error ? e.message : e); }
    }
    // Done once, even with nothing to copy (a signature logo), so it isn't read again.
    if (done && marked) await supabaseAdmin.from("messages").update({ files_copied_at: new Date().toISOString() }).eq("id", m.id);
  }
  const out = { ok: true, emails: data?.length ?? 0, looked, added };
  console.log("[cron/email-files]", JSON.stringify(out));
  return NextResponse.json(out);
}
