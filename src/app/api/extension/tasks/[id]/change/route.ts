import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { canActOnTask } from "@/lib/taskAccess";

// One change from a website review (Derek, 2026-09-30: "if I'm on a website I
// want to ... add changes to a list very quickly"). The clipper sends each
// change the moment Enter is pressed, and it lands twice on purpose:
//
//   a checklist item   the change itself, so the list is something to tick off
//   a comment          the full page address and the screenshots, which a
//                      checklist item has nowhere to hold
//
// Both through the row-locking RPCs, so a teammate ticking the list while
// changes arrive cannot lose either write.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: taskId } = await params;

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
  const url = typeof body.url === "string" && /^https?:\/\//i.test(body.url.trim()) ? body.url.trim().slice(0, 2000) : "";
  const pageTitle = typeof body.page_title === "string" ? body.page_title.trim().slice(0, 300) : "";
  const screenshotPaths: string[] = Array.isArray(body.screenshot_paths)
    ? body.screenshot_paths.filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 20)
    : [];
  if (!text) return NextResponse.json({ error: "Type the change first." }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("client_id, assignee_id, is_private, deleted_at, subtasks, status").eq("id", taskId).maybeSingle();
  // A finished or binned task is no place for new changes. 410 tells the
  // clipper to start a fresh "Website changes" task instead.
  if (!task || task.deleted_at || task.status === "done") return NextResponse.json({ error: "That task is closed.", gone: true }, { status: 410 });
  if (!(await canActOnTask(caller, task))) return NextResponse.json({ error: "Unknown or inaccessible task." }, { status: 403 });

  // Same rule as the comment route: only files uploaded for this task's client.
  const folder = `extension/${task.client_id}/`;
  if (screenshotPaths.some((p) => !p.startsWith(folder) || p.includes(".."))) {
    return NextResponse.json({ error: "Screenshots must be uploaded for this task's client." }, { status: 400 });
  }

  // The page's path on the item, so the list alone says where each one is.
  let where = "";
  try { where = url ? new URL(url).pathname : ""; } catch { /* leave it off */ }
  const itemTitle = where && where !== "/" ? `${text} · ${where}` : text;
  const n = (Array.isArray(task.subtasks) ? task.subtasks.length : 0) + 1;

  const item = { id: "s_" + randomUUID().replace(/-/g, ""), title: itemTitle, done: false };
  const { error: listErr } = await supabaseAdmin.rpc("append_subtasks", { task_id: taskId, items: [item], author: caller.memberId });
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 400 });

  const comment = {
    id: "cm_" + randomUUID(),
    authorId: caller.memberId,
    body: [`Change ${n}: ${text}`, [pageTitle, url].filter(Boolean).join("\n")].filter(Boolean).join("\n\n"),
    at: new Date().toISOString(),
    ...(screenshotPaths.length
      ? { attachments: screenshotPaths.map((path, i) => ({ id: "at_" + randomUUID(), name: screenshotPaths.length > 1 ? `Change ${n} screenshot ${i + 1}` : `Change ${n} screenshot`, kind: "image", size: "", path })) }
      : {}),
  };
  const { error } = await supabaseAdmin.rpc("append_comment", { task_id: taskId, comment });
  // The item is already on the list; say the rest failed rather than
  // pretending the whole change did.
  if (error) return NextResponse.json({ error: `Added to the list, but the screenshot note failed: ${error.message}` }, { status: 400 });
  return NextResponse.json({ ok: true, n, itemId: item.id });
}
