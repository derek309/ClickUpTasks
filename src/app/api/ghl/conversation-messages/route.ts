import { NextRequest, NextResponse } from "next/server";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Read-only live fetch of a single GoHighLevel conversation's message
// history — used for the "All GoHighLevel" thread preview on a contact not
// yet classified as a client/prospect/past client/vendor (so there's no
// local `messages` row to show instead). Never stored locally.

const GHL = "https://services.leadconnectorhq.com";

export async function GET(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get("conversationId");
  const locationId = searchParams.get("locationId");
  if (!conversationId || !locationId) return NextResponse.json({ error: "Missing conversationId or locationId." }, { status: 400 });

  const token = await tokenForLocation(locationId);
  if (!token) return NextResponse.json({ error: "No GoHighLevel token configured for this sub-account yet." }, { status: 501 });

  try {
    const res = await fetch(`${GHL}/conversations/${conversationId}/messages?limit=50`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `GoHighLevel API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 });
    }
    const json = await res.json().catch(() => ({}));
    const raw = (json?.messages?.messages ?? []) as any[];
    // GHL returns newest-first; flip to oldest-first to read top-to-bottom like a real thread.
    const messages = [...raw]
      .reverse()
      .map((m) => ({
        id: m.id,
        direction: m.direction === "outbound" ? "outbound" : "inbound",
        body: m.body || "",
        subject: m.meta?.email?.subject || null,
        at: m.dateAdded,
      }));
    return NextResponse.json({ messages });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "GoHighLevel request failed." }, { status: 502 });
  }
}
