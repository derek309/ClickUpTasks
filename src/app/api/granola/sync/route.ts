import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { granolaListNotesSince, granolaConfigured } from "@/lib/granolaClient";
import { syncOneGranolaNote } from "@/lib/granolaSyncServer";
import { allGranolaKeys, granolaKeyFor, type GranolaKey } from "@/lib/granolaKeys";

// Manual backfill, the last seven days: covers the gap before a webhook is
// registered and any note a webhook ever misses. An admin syncs every key
// (the deployment's and each teammate's own); anyone else syncs their own.

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const own = await granolaKeyFor(caller.id);
  const sources: (GranolaKey | undefined)[] = caller.role === "admin"
    ? [...(granolaConfigured ? [undefined] : []), ...(await allGranolaKeys())]
    : own ? [{ userId: caller.id, key: own }] : [];
  if (!sources.length) return NextResponse.json({ error: "No Granola key yet. Add yours in Settings, Granola." }, { status: 400 });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let checked = 0, created = 0, unmatched = 0, skipped = 0, internal = 0, failed = 0;
  const errors: string[] = [];
  for (const by of sources) {
    let notes;
    try {
      notes = await granolaListNotesSince(sevenDaysAgo, by?.key);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Granola list failed.");
      continue;
    }
    checked += notes.length;
    for (const n of notes) {
      try {
        const result = await syncOneGranolaNote(n.id, by);
        if (result === "created") created++;
        else if (result === "unmatched") unmatched++;
        else if (result === "internal") internal++;
        else skipped++;
      } catch (e) {
        failed++;
        console.error(`[granola/sync] note ${n.id} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
  if (errors.length && !checked) return NextResponse.json({ error: errors[0] }, { status: 502 });
  return NextResponse.json({ ok: true, keys: sources.length, checked, created, unmatched, internal, skipped, failed });
}
