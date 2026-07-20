import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { mapActivityLog } from "../activity/route";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Fetch one directory business's full detail — used to load its outreach
// activity history on demand (the touch log). Proxies WP GET
// /sales/listing/{id} (returns the same payload the write path returns) with
// the shared key. requireUser-gated; 501 before env vars are set.

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
const configured = Boolean(WP_BASE && WP_KEY);

export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!configured) return NextResponse.json({ error: "Directory not configured" }, { status: 501 });

  const listingId = (new URL(req.url).searchParams.get("listingId") || "").trim();
  if (!/^\d+$/.test(listingId)) return NextResponse.json({ error: "listingId (numeric) is required" }, { status: 400 });

  const url = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/listing/${listingId}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "X-ClickUpTasks-Key": WP_KEY, Accept: "application/json" } });
  } catch (e: any) {
    return NextResponse.json({ error: "Directory fetch failed", detail: String(e?.message ?? e) }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json({ error: data?.error || `Directory responded ${res.status}` }, { status: 502 });

  return NextResponse.json({ activityLog: mapActivityLog(data?.activity_log) });
}
