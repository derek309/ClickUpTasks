import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";

// Marks the caller's own message notifications read from the Inboxes Mac app,
// the same flag opening a task sets in the web app (markTaskNotifsRead in
// Cockpit.tsx). { task_id } covers every message notification on that task,
// { id } one notification (a Journal mention has no task). read: false puts
// them back, for Inboxes' undo. Only rows addressed to the caller change.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!caller.memberId) return NextResponse.json({ error: "This token's account has no roster member id." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" && body.id ? body.id : null;
  const taskId = typeof body.task_id === "string" && body.task_id ? body.task_id : null;
  if (!id && !taskId) return NextResponse.json({ error: "Send id or task_id." }, { status: 400 });
  const read = body.read !== false;

  const scope = supabaseAdmin.from("notifications").update({ read })
    .eq("recipient_id", caller.memberId).eq("kind", "message");
  const { error } = await (id ? scope.eq("id", id) : scope.eq("task_id", taskId!));
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
