import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { freeSlots } from "@/lib/calendarService";

// Open times on one GoHighLevel calendar for the next week (Phase 2, Derek,
// 2026-10-05). Read only; cached a minute per calendar in calendarService.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!(await requireUser(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const calendarId = req.nextUrl.searchParams.get("calendarId") ?? "";
  if (!/^[\w-]{6,40}$/.test(calendarId)) return NextResponse.json({ error: "Pick a calendar." }, { status: 400 });
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 7, 1), 21);
  const r = await freeSlots(calendarId, days);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
