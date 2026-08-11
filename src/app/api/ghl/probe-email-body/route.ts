import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { tokenForLocation, configuredLocations } from "@/lib/ghlTokens";

/* eslint-disable @typescript-eslint/no-explicit-any */

// TEMPORARY diagnostic — delete once the GHL email-body contract is confirmed.
// GHL's conversations/{id}/messages response omits `body` on ~1 in 3 email
// messages (237 of 707 GHL-sourced emails as of 2026-08-11), and there is a
// separate per-email endpoint that is supposed to carry the full content.
// Rather than guess its path/shape and ship a backfill against an assumed
// contract, this hits the candidates once against a real message id and
// reports status + top-level keys so the real shape decides the design.
//
// Auth: the same shared secret the other machine-to-machine routes use.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  // Its own throwaway secret, NOT GHL_WEBHOOK_SECRET: that one is what
  // WordPress signs its inbound webhooks with, so rotating it to something
  // readable here would break a live integration. This var is created for
  // this probe and removed with the route.
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.PROBE_SECRET || secret !== process.env.PROBE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const messageId = req.nextUrl.searchParams.get("messageId") ?? "";
  if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

  const locations = await configuredLocations();
  const locationId = req.nextUrl.searchParams.get("locationId") || locations[0] || "";
  const token = await tokenForLocation(locationId);
  if (!token) return NextResponse.json({ error: "No token", locations }, { status: 400 });

  const headers = { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" };
  const candidates = [
    `https://services.leadconnectorhq.com/conversations/messages/${encodeURIComponent(messageId)}`,
    `https://services.leadconnectorhq.com/conversations/messages/email/${encodeURIComponent(messageId)}`,
  ];

  const results: any[] = [];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* non-JSON body, keep the raw sample */ }
      // Keys + a short sample only — never dump a whole customer email here.
      const describe = (o: any, depth = 0): any => {
        if (!o || typeof o !== "object" || depth > 2) return typeof o;
        if (Array.isArray(o)) return [`array(${o.length})`, o.length ? describe(o[0], depth + 1) : null];
        return Object.fromEntries(Object.entries(o).map(([k, v]) => [
          k,
          typeof v === "string" ? `string(${v.length})` : describe(v, depth + 1),
        ]));
      };
      results.push({
        url, status: res.status,
        shape: json ? describe(json) : null,
        sample: text.slice(0, 200),
      });
    } catch (e) {
      results.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ locationId, messageId, results });
}
