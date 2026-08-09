import { NextRequest, NextResponse } from "next/server";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";

// TEMPORARY — checks whether Lincoln's 11 "Clicked, hasn't answered" WP
// listings are real, distinct businesses (and whether they have contact
// info to match against). Deleted after this runs.
const GD_PLACE_IDS = [13780, 14403, 14420, 14107, 13789, 14427, 14409, 14425, 13770, 14389, 14355];

export async function POST(req: NextRequest) {
  if (req.headers.get("x-backfill-secret") !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await fetchDirectoryListingsServer("Lincoln", "CA");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });
  const byId = new Map(result.listings.map((l) => [typeof l.id === "number" ? l.id : parseInt(String(l.id), 10), l]));
  const rows = GD_PLACE_IDS.map((id) => {
    const l = byId.get(id);
    return l ? { id, name: l.name, phone: l.phone, email: l.email, ghlContactId: l.ghlContactId, claimed: l.claimed } : { id, name: null };
  });
  return NextResponse.json({ ok: true, rows });
}
