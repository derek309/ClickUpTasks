import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { sendPlannerInviteServer } from "@/lib/plannerInviteServer";

// Sends WordPress's existing "invite this business to be featured" email
// (GHL Conversations API) for one candidate — proxies WordPress's own
// cul_sales_rest_outreach_send, which already owns the real work (GHL
// contact upsert + send + activity logging on its own per-(city,week)
// outreach record). ClickUpTasks is just the trigger button here, per
// /Users/derekfox/.claude/plans/twinkly-puzzling-prism.md — the outreach
// board itself stays WordPress-owned, unlike the Content Planner's own data.
//
// The real send logic lives in plannerInviteServer.ts so the planner
// auto-invite cron can call it directly without a user session.

// WordPress now generates this week's email template on the fly (a Gemini
// call) when none has been saved yet, instead of failing with no_template —
// bump past the default serverless timeout for that extra latency.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const territoryId = String(body?.territoryId ?? "").trim();
  const week = String(body?.week ?? "").trim();
  const gdPlaceId = Number(body?.gdPlaceId);
  const themeDescription = String(body?.themeDescription ?? "").trim();
  if (!territoryId || !/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isFinite(gdPlaceId)) {
    return NextResponse.json({ error: "territoryId, week (yyyy-mm-dd), and gdPlaceId are required" }, { status: 400 });
  }

  const result = await sendPlannerInviteServer(territoryId, week, gdPlaceId, themeDescription);
  if (!result.ok && result.error.startsWith("Invite sending isn't configured")) return NextResponse.json({ error: result.error }, { status: 501 });
  if (!result.ok && (result.error === "Territory not found")) return NextResponse.json({ error: result.error }, { status: 404 });
  if (!result.ok && result.error.includes("no city name")) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
