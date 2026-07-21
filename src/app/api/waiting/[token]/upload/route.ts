import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { TASK_FILES_BUCKET } from "@/lib/db";

const MAX_BYTES = 25 * 1024 * 1024;

// Public, token-gated file upload for the client-response form on
// /waiting/[token] — mirrors src/app/api/extension/upload/route.ts's
// storage mechanics (supabaseAdmin, private task-files bucket, return the
// object path not a public URL) but validates against clients.share_token
// instead of requireApiToken, since the caller has no account at all.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: client } = await supabaseAdmin.from("clients").select("id").eq("share_token", token).maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const taskId = form?.get("task_id");
  const file = form?.get("file");
  if (typeof taskId !== "string" || !taskId) return NextResponse.json({ error: "Missing task_id." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be under 25MB." }, { status: 400 });

  // Confirm the task actually belongs to this token's own client before
  // writing anywhere — same boundary the respond route enforces.
  const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id").eq("id", taskId).maybeSingle();
  if (!task || task.client_id !== client.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `waiting/${client.id}/${taskId}/${randomUUID()}-${safe}`;
  const { error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ path });
}
