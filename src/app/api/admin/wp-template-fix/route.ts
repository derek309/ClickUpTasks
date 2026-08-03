import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

// TEMPORARY, one-off admin utility — clears/overwrites a stale cached
// per-(city,week) outreach email template on the WordPress side
// (cul_sales_outreach_templates_*), since ClickUpTasks has no UI for this
// (the WP "Sales tool" screen that used to edit it was retired) and the
// production CLICKUPTASKS_API_KEY only exists in this deployed app's own
// env, not locally. Delete this route once used — it's not a real feature.

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller || caller.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!WP_BASE || !WP_KEY) return NextResponse.json({ error: "Not configured" }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const city = String(body?.city ?? "").trim();
  const week = String(body?.week ?? "").trim();
  const value = String(body?.value ?? "");
  if (!city || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return NextResponse.json({ error: "city and week (yyyy-mm-dd) are required" }, { status: 400 });
  }

  const res = await fetch(`${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/templates`, {
    method: "POST",
    headers: { "X-ClickUpTasks-Key": WP_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ city, week, field: "email", value }),
  });
  const data = await res.json().catch(() => null);
  return NextResponse.json({ ok: res.ok, status: res.status, data });
}
