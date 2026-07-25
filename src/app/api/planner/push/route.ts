import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pushes a saved Content Planner week out to WordPress so the public
// "{City} Weekly" archive page (newsletter-archive.php) — which reads the
// wp_options row directly — stays in sync. ClickUpTasks is the source of
// truth for planner data now; this is a write-only sync target, not a
// two-way read (see supabase/planner.sql, /Users/derekfox/.claude/plans/
// twinkly-puzzling-prism.md). Forwards to the new cul/v1/sales/planner-push
// WordPress endpoint, gated by the same shared key the other /api/directory/*
// proxies already use. 501s before the env vars are configured.

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
const configured = Boolean(WP_BASE && WP_KEY);

// Rough JS approximation of WordPress's PHP sanitize_title() — good enough
// as a fallback when a territory has no explicit wp_city_slug override.
// Punctuation/diacritic edge cases can still drift; that's exactly what the
// override column is for.
function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!configured) return NextResponse.json({ error: "WordPress push isn't configured yet (missing CUL_WP_BASE_URL/CLICKUPTASKS_API_KEY)." }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const territoryId = String(body?.territoryId ?? "").trim();
  const week = String(body?.week ?? "").trim();
  const picks = body?.picks;
  if (!territoryId || !/^\d{4}-\d{2}-\d{2}$/.test(week) || !picks || typeof picks !== "object") {
    return NextResponse.json({ error: "territoryId, week (yyyy-mm-dd), and picks are required" }, { status: 400 });
  }

  const { data: territory } = await supabaseAdmin.from("territories").select("city, wp_city_slug").eq("id", territoryId).maybeSingle();
  if (!territory) return NextResponse.json({ error: "Territory not found" }, { status: 404 });
  const citySlug = (territory.wp_city_slug as string | null) || slugify(String(territory.city ?? ""));
  if (!citySlug) return NextResponse.json({ error: "This territory has no city name or wp_city_slug to push to." }, { status: 400 });

  const url = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/planner-push`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "X-ClickUpTasks-Key": WP_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ city: citySlug, week, picks }),
    });
  } catch (e: any) {
    return NextResponse.json({ error: "WordPress push failed", detail: String(e?.message ?? e) }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json({ error: data?.error || `WordPress responded ${res.status}` }, { status: 502 });

  return NextResponse.json({ ok: true, citySlug, pushedAt: new Date().toISOString() });
}
