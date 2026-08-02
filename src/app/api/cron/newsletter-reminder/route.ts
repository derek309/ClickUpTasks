import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { runNewsletterReminderCheck } from "@/lib/newsletterReminderServer";

// Daily check that every territory has a "send this week's newsletter" task
// due — see newsletterReminderServer.ts. Same 3-way cron auth as the other
// crons.

export const maxDuration = 60;

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
  if (!cronOk && !secretOk) {
    const caller = await requireUser(req);
    if (!caller || caller.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runNewsletterReminderCheck();
  return NextResponse.json({ ok: true, ...result });
}
