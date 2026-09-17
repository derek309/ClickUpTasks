import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { purgeApprovedVideos, storedVideoBytes } from "@/lib/videoCleanupServer";

// Daily sweep: clears a video review's file 30 days after the review was
// approved (supabase/task-video-purge.sql). Same cron auth as the others
// (cronAuth.ts), which also lets an admin run it from the app.
//
// The reply carries how much video is still stored, so running this by hand
// answers "what is video costing us" at the same time.

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

  const result = await purgeApprovedVideos();
  const stored = await storedVideoBytes();
  return NextResponse.json({ ok: true, ...result, stillStored: stored });
}
