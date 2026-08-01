import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { syncOneGranolaNote } from "@/lib/granolaSyncServer";

// Inbound Granola -> ClickUpTasks: fires the moment a meeting's AI summary is
// ready (note.generated/note.regenerated). The payload carries only the note
// id — syncOneGranolaNote fetches the real content via Granola's API and
// files it into the right client's Journal. Standard Webhooks signing
// (https://www.standardwebhooks.com/): HMAC-SHA256 of "{id}.{timestamp}.{body}"
// keyed by the base64 half of GRANOLA_WEBHOOK_SECRET (format "whsec_<base64>").
// Registered once via /api/granola/setup-webhook, which is what produces that
// secret in the first place.

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function verifySignature(id: string, timestamp: string, rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.GRANOLA_WEBHOOK_SECRET;
  if (!secret) return false;
  const secretB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(secretB64, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  const expectedBuf = Buffer.from(expected);
  return signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter(Boolean)
    .some((sig) => {
      const sigBuf = Buffer.from(sig);
      return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
    });
}

export async function POST(req: NextRequest) {
  const id = req.headers.get("webhook-id");
  const timestamp = req.headers.get("webhook-timestamp");
  const signature = req.headers.get("webhook-signature");
  if (!id || !timestamp || !signature) return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });

  const skewMs = Math.abs(Date.now() - Number(timestamp) * 1000);
  if (!Number.isFinite(skewMs) || skewMs > MAX_CLOCK_SKEW_MS) return NextResponse.json({ error: "Timestamp out of range" }, { status: 401 });

  const rawBody = await req.text();
  if (!verifySignature(id, timestamp, rawBody, signature)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const payload = JSON.parse(rawBody) as { event_type?: string; note_id?: string };
  if ((payload.event_type === "note.generated" || payload.event_type === "note.regenerated") && payload.note_id) {
    try {
      await syncOneGranolaNote(payload.note_id);
    } catch (e) {
      console.error("[granola/webhook] sync failed:", e instanceof Error ? e.message : e);
      // Still 200 — a Granola-side retry won't help if our own sync failed on
      // good data, and the manual backfill route can pick it up later.
    }
  }
  return NextResponse.json({ ok: true });
}
