import { NextRequest, NextResponse } from "next/server";
import { writeToken } from "@/lib/ghlTokens";

// Saves a GoHighLevel Private Integration token for a sub-account after
// verifying it works. The token is written server-side (gitignored file) and is
// never echoed back to the browser.
export async function POST(req: NextRequest) {
  const { locationId, token } = await req.json().catch(() => ({}));
  if (!locationId || !token) return NextResponse.json({ error: "Location ID and token are both required." }, { status: 400 });

  // Verify the token + location against the live GHL API before saving.
  const res = await fetch(
    `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&limit=1`,
    { headers: { Authorization: `Bearer ${String(token).trim()}`, Version: "2021-07-28", Accept: "application/json" } }
  );
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `GoHighLevel rejected it (${res.status}). Check the token and Location ID. ${text.slice(0, 160)}` }, { status: 400 });
  }

  writeToken(String(locationId).trim(), String(token).trim());
  return NextResponse.json({ ok: true });
}
