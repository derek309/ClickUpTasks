import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { purgeExpiredTrash, purgeOldUnmatched } from "@/lib/trashCleanupServer";
import { purgeOldMentionThreads } from "@/lib/mentionReply";
import { runListKindsDaily } from "@/lib/listKindsServer";

// Daily sweep — permanently deletes clients/projects/tasks past their
// 30-day Trash window (see supabase/soft-delete.sql). Same cron auth as the
// other crons (cronAuth.ts).
//
// It also does the housekeeping that is not trash: mention email threads, which
// are only worth keeping while a reply might still arrive
// (supabase/mention-email-threads.sql), and unmatched emails and meeting notes
// older than 90 days.
//
// And a list's kind (mcp/listKinds.mjs, 2026-10-17): a repeating list's next
// round when one is due, and the Now check on a finishing list's queue, so an
// Up next task needed within 3 weeks comes up on its own. It never fails the
// sweep.

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
  const mentionThreads = await purgeOldMentionThreads();
  const unmatched = await purgeOldUnmatched();
  const lists = await runListKindsDaily().catch((e) => ({ rounds: 0, pulled: 0, skipped: String(e?.message ?? e) }));
  return NextResponse.json({ ok: true, ...result, mentionThreads, unmatched, lists });
}
