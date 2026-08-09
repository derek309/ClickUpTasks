import { NextRequest, NextResponse } from "next/server";
import { fetchJoinFunnelServer } from "@/lib/joinFunnelServer";

// TEMPORARY — confirm the real WP join-chat funnel step value strings before
// hardcoding a mapping in the Businesses page rewrite. Deleted after this runs.
export async function POST(req: NextRequest) {
  if (req.headers.get("x-backfill-secret") !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const territoryId = searchParams.get("territoryId") || "";
  const result = await fetchJoinFunnelServer(territoryId);
  return NextResponse.json(result);
}
