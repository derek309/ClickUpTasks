import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess } from "@/lib/taskDocumentServer";
import { sendTaskFileToSite } from "@/lib/clientWebsite";

// POST { file }: one of the task's stored files into the client's website
// Media Library (Derek, 2026-10-12). Anyone on the team who can see the task.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const b = (await req.json().catch(() => ({}))) as { file?: string };
  if (!b.file) return NextResponse.json({ error: "Which file?" }, { status: 400 });
  const r = await sendTaskFileToSite(id, b.file);
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: 400 });
}
