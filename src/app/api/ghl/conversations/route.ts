import { NextRequest, NextResponse } from "next/server";
import { configuredLocations, tokenForLocation } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Live GoHighLevel conversations across every configured sub-account, merged
// into one list — the "All GoHighLevel" side of the Conversations inbox
// (as opposed to the "Tracked" side, which is our own `messages` table for
// contacts already classified as a client/prospect/past client/vendor).
// Never stored locally: fetched fresh on each request, same trust/staleness
// tradeoff as the existing GHL contact search in AddClientModal.

const GHL = "https://services.leadconnectorhq.com";

export async function GET(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("query")?.trim() ?? "";
  const limitPerLocation = Math.min(Number(searchParams.get("limit")) || 40, 100);

  const locations = await configuredLocations();
  if (locations.length === 0) return NextResponse.json({ conversations: [] });

  const perLocation = await Promise.all(
    locations.map(async (locationId) => {
      const token = await tokenForLocation(locationId);
      if (!token) return [];
      const params = new URLSearchParams({ locationId, limit: String(limitPerLocation) });
      if (query) params.set("query", query);
      try {
        const res = await fetch(`${GHL}/conversations/search?${params}`, {
          headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" },
        });
        if (!res.ok) return [];
        const json = await res.json().catch(() => ({}));
        return (json?.conversations ?? []) as any[];
      } catch {
        return [];
      }
    })
  );

  const conversations = perLocation
    .flat()
    .map((c) => ({
      id: c.id,
      locationId: c.locationId,
      contactId: c.contactId,
      contactName: c.fullName || c.contactName || "Unknown",
      companyName: c.companyName || "",
      email: c.email || "",
      phone: c.phone || "",
      lastMessageBody: (c.lastMessageBody || "").slice(0, 300),
      lastMessageDate: c.lastMessageDate ? new Date(c.lastMessageDate).toISOString() : null,
      lastMessageDirection: c.lastMessageDirection === "outbound" ? "outbound" : "inbound",
      unreadCount: c.unreadCount || 0,
    }))
    .sort((a, b) => (b.lastMessageDate ?? "").localeCompare(a.lastMessageDate ?? ""));

  return NextResponse.json({ conversations });
}
