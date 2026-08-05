import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { runPlannerAutoInvite } from "@/lib/plannerAutoInviteServer";

// Daily auto-invite for the Content Planner — see plannerAutoInviteServer.ts
// (fires once at 9am Pacific, weekdays only). Same 3-way cron auth as the
// other crons. WordPress sends can take a few seconds each across several
// territories, so this gets a longer ceiling than the other crons' default.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });

  const authHeader = req.headers.get("authorization") ?? "";
  const cronOk = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const secretOk = !!process.env.GHL_WEBHOOK_SECRET && req.nextUrl.searchParams.get("secret") === process.env.GHL_WEBHOOK_SECRET;
  let manualAdmin = false;
  if (!cronOk && !secretOk) {
    const caller = await requireUser(req);
    if (!caller || caller.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    manualAdmin = true;
  }

  // force/territoryId only ever come from an authenticated admin's own
  // "Send now" click (Businesses page) — the cron and the webhook-secret
  // path stay exactly what they were, the full unattended daily run.
  const body = manualAdmin ? await req.json().catch(() => null) : null;
  const territoryId = typeof body?.territoryId === "string" ? body.territoryId : undefined;
  const force = body?.force === true;

  const result = await runPlannerAutoInvite({ force, territoryId });
  return NextResponse.json(result);
}
