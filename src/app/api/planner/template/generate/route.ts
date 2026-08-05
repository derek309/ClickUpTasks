import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/serverAuth";
import { generatePlannerTemplateServer } from "@/lib/plannerTemplateServer";

// Draft a fresh invite email from WordPress's own AI prompt (grounded in this
// week's theme and city). Returns the text WITHOUT saving it — the sibling
// POST /api/planner/template is the only thing that writes. Same admin bar as
// that route.

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const territoryId = String(body?.territoryId ?? "").trim();
  const week = String(body?.week ?? "").trim();
  if (!territoryId || !WEEK_RE.test(week)) return NextResponse.json({ error: "territoryId and week (yyyy-mm-dd) are required" }, { status: 400 });

  const result = await generatePlannerTemplateServer(territoryId, week);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, text: result.text });
}
