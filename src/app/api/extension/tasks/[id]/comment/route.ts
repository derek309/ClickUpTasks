import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";

// "Add to existing task" — posts a comment (with an optional screenshot
// attachment) instead of creating a new task. Mirrors appendCommentDb's
// call shape (src/lib/db.ts) exactly, just via supabaseAdmin instead of the
// browser-session client — this is new server-side comment-posting logic;
// the atomic append_comment RPC (supabase/realtime.sql) is what makes this
// safe against a race with someone else commenting on the same task at the
// same time, unlike a read-then-replace.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: taskId } = await params;

  const body = await req.json().catch(() => ({}));
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const screenshotPath = typeof body.screenshot_path === "string" && body.screenshot_path.trim() ? body.screenshot_path.trim() : null;
  if (!text && !screenshotPath) return NextResponse.json({ error: "Nothing to add — no note or screenshot." }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("client_id").eq("id", taskId).maybeSingle();
  if (!task) return NextResponse.json({ error: "No such task." }, { status: 404 });
  if (!(await isClientVisible(caller, task.client_id))) return NextResponse.json({ error: "Unknown or inaccessible task." }, { status: 403 });

  const comment = {
    id: "cm_" + randomUUID(),
    authorId: caller.memberId,
    body: text,
    at: new Date().toISOString(),
    ...(screenshotPath ? { attachments: [{ id: "at_" + randomUUID(), name: "Screenshot", kind: "image", size: "", path: screenshotPath }] } : {}),
  };
  const { error } = await supabaseAdmin.rpc("append_comment", { task_id: taskId, comment });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, taskId });
}
