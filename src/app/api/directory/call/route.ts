import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Kick off a bridge call to a directory business — the /sales "Call" action.
// Proxies WP POST /sales/listing/{id}/call, which fires the GHL bridge-call
// workflow (rings the rep first, then dials the business and patches them
// through). The WP endpoint now accepts the rep's identity in the body (a
// machine caller has no WP user), so we pass the signed-in teammate's name +
// email; GHL resolves the rep's phone from that. requireUser-gated.

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
const configured = Boolean(WP_BASE && WP_KEY);

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!configured) return NextResponse.json({ error: "Directory not configured" }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const listingId = String(body?.listingId ?? "").trim();
  if (!/^\d+$/.test(listingId)) return NextResponse.json({ error: "listingId (numeric) is required" }, { status: 400 });

  // Look up the caller's display name for the rep identity (email is on the
  // token; name comes from the roster profile).
  let repName = caller.email;
  if (caller.memberId) {
    const { data } = await supabaseAdmin.from("profiles").select("name").eq("member_id", caller.memberId).maybeSingle();
    if (data?.name) repName = data.name;
  }

  const url = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/listing/${listingId}/call`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "X-ClickUpTasks-Key": WP_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ rep_name: repName, rep_email: caller.email }),
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Call failed", detail: String(e?.message ?? e) }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json({ error: data?.error || `Call responded ${res.status}` }, { status: 502 });
  return NextResponse.json({ ok: true, phone: data?.phone ?? "" });
}
