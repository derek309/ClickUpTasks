import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { fetchDirectoryListingsServer } from "@/lib/directoryListingsServer";

// Proxy the ClickUpLocal WordPress directory (GeoDirectory) into the task app
// so the territory/city view can show a business's real directory listing
// status the same way the /sales field tool does: claimed vs unclaimed,
// CUL score, category. Live-fetched per city (no local copy) — the directory
// is the source of truth, and an ambassador opening a city wants it current.
//
// Auth: the caller must be a signed-in task-app user (requireUser). The real
// fetch/pagination/normalize logic lives in directoryListingsServer.ts so the
// planner auto-invite cron can call it directly without a user session.

export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const city = (searchParams.get("city") || "").trim();
  const state = (searchParams.get("state") || "").trim();
  if (!city) return NextResponse.json({ error: "city is required", listings: [] }, { status: 400 });

  const result = await fetchDirectoryListingsServer(city, state);
  if ("error" in result) return NextResponse.json({ error: result.error, listings: [] }, { status: result.status });

  // Our own truncation flag, not WP's — WP reports truncated:false even when
  // it capped the result at per_page, so trusting it hid the missing tail.
  return NextResponse.json({ listings: result.listings, total: result.total, truncated: result.truncated });
}
