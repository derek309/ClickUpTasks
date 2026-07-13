import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/serverAuth";

const MAX_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const id = form?.get("id");
  const file = form?.get("file");
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "Missing user id." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file." }, { status: 400 });
  const ext = CONTENT_TYPE_EXT[file.type];
  if (!ext) return NextResponse.json({ error: "Use a JPEG, PNG, WebP, or GIF image." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be under 5MB." }, { status: 400 });

  // Fixed path per user (not a fresh filename each time) so a re-upload
  // overwrites in place rather than accumulating orphaned old photos.
  const path = `${id}/avatar.${ext}`;
  const { error: upErr } = await supabaseAdmin.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  const { data: pub } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);
  // Cache-bust: the path is stable, so without this a browser that already
  // cached the old image at this URL would keep showing it after a re-upload.
  const avatarUrl = `${pub.publicUrl}?v=${Date.now()}`;
  const { error: dbErr } = await supabaseAdmin.from("profiles").update({ avatar_url: avatarUrl }).eq("id", id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, avatar_url: avatarUrl });
}
