import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { purgeExpiredTrash } from "@/lib/trashCleanupServer";

// Daily sweep — permanently deletes clients/projects/tasks past their
// 30-day Trash window (see supabase/soft-delete.sql). Same cron auth as the
// other crons (cronAuth.ts).

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await purgeExpiredTrash();
  return NextResponse.json({ ok: true, ...result });
}
