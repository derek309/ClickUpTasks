import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { fetchJoinFunnelServer } from "@/lib/joinFunnelServer";

// Proxy WordPress's /join chat funnel for one territory's city into the task
// app, so the Businesses page can answer "which chat screen do people fall off
// on" without anyone opening WordPress. Same auth/shape as the sibling
// /api/directory/listings proxy: a signed-in task-app user, with the real work
// in joinFunnelServer.ts so a server-only caller can skip requireUser.
//
// 501s (not connected) before CUL_WP_BASE_URL/CLICKUPTASKS_API_KEY are set —
// the panel just hides itself in that case.

export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const territoryId = (searchParams.get("territoryId") || "").trim();
  if (!territoryId) return NextResponse.json({ error: "territoryId is required", steps: [], byGdPlaceId: {} }, { status: 400 });

  const result = await fetchJoinFunnelServer(territoryId);
  if ("error" in result) return NextResponse.json({ error: result.error, steps: [], byGdPlaceId: {} }, { status: result.status });

  return NextResponse.json(result);
}
