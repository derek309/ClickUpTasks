import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";
import { TASK_FILES_BUCKET } from "@/lib/db";

const MAX_BYTES = 5 * 1024 * 1024;

// Screenshot upload for the extension's review mode — mirrors
// src/app/api/team/avatar/route.ts's shape (parse formData, pull a File,
// upload via supabaseAdmin) but targets the private task-files bucket
// (avatars is public) and returns the storage path rather than a public
// URL, same as every other task attachment.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const clientId = form?.get("client_id");
  const file = form?.get("file");
  if (typeof clientId !== "string" || !clientId) return NextResponse.json({ error: "Missing client_id." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Screenshot must be under 5MB." }, { status: 400 });
  if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });

  // Namespaced under extension/ so these never collide with the main app's
  // own task-attachment paths.
  const path = `extension/${clientId}/${randomUUID()}.png`;
  const { error } = await supabaseAdmin.storage.from(TASK_FILES_BUCKET).upload(path, file, { upsert: false, contentType: file.type || "image/png" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ path });
}
