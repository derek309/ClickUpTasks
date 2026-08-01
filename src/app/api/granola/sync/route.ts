import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/serverAuth";
import { granolaListNotesSince, granolaConfigured } from "@/lib/granolaClient";
import { syncOneGranolaNote } from "@/lib/granolaSyncServer";

// Manual backfill — covers the gap between "API key added" and "webhook
// registered", and any note the webhook ever misses. Admin-only, triggered
// by the "Sync recent meetings" button in Settings > Integrations.

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!granolaConfigured) return NextResponse.json({ error: "GRANOLA_API_KEY is not configured." }, { status: 501 });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let notes;
  try {
    notes = await granolaListNotesSince(sevenDaysAgo);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Granola list failed." }, { status: 502 });
  }

  let created = 0, unmatched = 0, skipped = 0, internal = 0, failed = 0;
  for (const n of notes) {
    try {
      const result = await syncOneGranolaNote(n.id);
      if (result === "created") created++;
      else if (result === "unmatched") unmatched++;
      else if (result === "internal") internal++;
      else skipped++;
    } catch (e) {
      failed++;
      console.error(`[granola/sync] note ${n.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ ok: true, checked: notes.length, created, unmatched, internal, skipped, failed });
}
