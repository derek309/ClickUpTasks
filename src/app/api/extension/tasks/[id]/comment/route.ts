import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { canActOnTask } from "@/lib/taskAccess";

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
  const screenshotPaths: string[] = Array.isArray(body.screenshot_paths) ? body.screenshot_paths.filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0) : [];
  // The email's own attachments, when the clipper adds an email to a task that
  // already exists (the same shape a new task takes them in).
  const files: { path: string; name: string; kind: string }[] = Array.isArray(body.files)
    ? body.files
        .filter((f: unknown): f is Record<string, unknown> => !!f && typeof f === "object")
        .map((f: Record<string, unknown>) => ({
          path: typeof f.path === "string" ? f.path : "",
          name: typeof f.name === "string" && f.name.trim() ? f.name.trim().slice(0, 200) : "Attachment",
          kind: f.kind === "image" ? "image" : "file",
        }))
        .filter((f: { path: string }) => f.path.length > 0)
        .slice(0, 20)
    : [];
  if (!text && !screenshotPaths.length && !files.length) return NextResponse.json({ error: "Nothing to add — no note, screenshot or file." }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("client_id, assignee_id, is_private, deleted_at").eq("id", taskId).maybeSingle();
  if (!task) return NextResponse.json({ error: "No such task." }, { status: 404 });
  if (!(await canActOnTask(caller, task))) return NextResponse.json({ error: "Unknown or inaccessible task." }, { status: 403 });

  // Screenshots come from /api/extension/upload, which files them under the
  // client picked in the side panel, the same client whose tasks it lists.
  // Any other path could hang another client's file on this comment, and the
  // app signs attachment paths for whoever opens the task.
  const folder = `extension/${task.client_id}/`;
  if ([...screenshotPaths, ...files.map((f) => f.path)].some((p) => !p.startsWith(folder) || p.includes(".."))) {
    return NextResponse.json({ error: "Screenshots and files must be uploaded for this task's client." }, { status: 400 });
  }

  const comment = {
    id: "cm_" + randomUUID(),
    authorId: caller.memberId,
    body: text,
    at: new Date().toISOString(),
    ...(screenshotPaths.length || files.length
      ? { attachments: [
          ...files.map((f) => ({ id: "at_" + randomUUID(), name: f.name, kind: f.kind, size: "", path: f.path })),
          ...screenshotPaths.map((path: string, i: number) => ({ id: "at_" + randomUUID(), name: screenshotPaths.length > 1 ? `Screenshot ${i + 1}` : "Screenshot", kind: "image", size: "", path })),
        ] }
      : {}),
  };
  const { error } = await supabaseAdmin.rpc("append_comment", { task_id: taskId, comment });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, taskId });
}
