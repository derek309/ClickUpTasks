import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/serverAuth";
import { fetchPlannerTemplateServer, savePlannerTemplateServer } from "@/lib/plannerTemplateServer";

// Read + write this week's invite email for one territory's city, proxied to
// WordPress (which owns the storage — one option per city/week). Admin only,
// the same bar as the daily invite cap control it sits next to: this is the
// copy that goes out to every business in the city, so it's an owner-level
// setting, not a per-rep one.
//
// 501s (not connected) before CUL_WP_BASE_URL/CLICKUPTASKS_API_KEY are set —
// the panel shows that as a plain "not connected" line rather than failing.

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const territoryId = (searchParams.get("territoryId") || "").trim();
  const week = (searchParams.get("week") || "").trim();
  if (!territoryId || !WEEK_RE.test(week)) return NextResponse.json({ error: "territoryId and week (yyyy-mm-dd) are required" }, { status: 400 });

  const result = await fetchPlannerTemplateServer(territoryId, week);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, email: result.email });
}

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const territoryId = String(body?.territoryId ?? "").trim();
  const week = String(body?.week ?? "").trim();
  // An empty string is a legitimate save (clear it and let WordPress generate
  // one on the fly at send time), so only a missing/non-string value is a 400.
  const value = typeof body?.value === "string" ? body.value : null;
  if (!territoryId || !WEEK_RE.test(week) || value === null) return NextResponse.json({ error: "territoryId, week (yyyy-mm-dd), and value are required" }, { status: 400 });

  const result = await savePlannerTemplateServer(territoryId, week, value);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
