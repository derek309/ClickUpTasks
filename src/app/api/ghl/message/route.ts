import { NextRequest, NextResponse } from "next/server";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Send an email or SMS to a GHL contact via GoHighLevel's Conversations API,
// so it goes out from the sub-account's own connected email/number, not a
// separate provider. This route is a pure GHL bridge (same shape as
// ../task/route.ts): it does the external call and returns the result; the
// caller (Cockpit.tsx sendMessage) inserts the local `messages` row itself
// after a confirmed success, matching how pushToGhl awaits ghlCall before
// writing locally.
//
// GHL's exact response field naming for this endpoint wasn't confirmed against
// a live send while building this (docs render client-side JS that couldn't be
// fetched); the id is read defensively from every shape reasonably documented
// (conversationId/messageId/message.id). If the very first real send returns
// none of these, log the raw response once and add the real field name here —
// ghl_message_id is only used for idempotency on the inbound side, so a null
// id degrades to "can't dedupe that one send," not a broken feature.

const GHL = "https://services.leadconnectorhq.com";

export async function POST(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const { locationId, ghlContactId, channel, subject, body } = b as {
    locationId?: string;
    ghlContactId?: string;
    channel?: string;
    subject?: string;
    body?: string;
  };

  if (!locationId || !ghlContactId || !body?.trim())
    return NextResponse.json({ error: "Missing locationId, ghlContactId, or body." }, { status: 400 });

  const token = await tokenForLocation(locationId);
  if (!token)
    return NextResponse.json({ error: "No GoHighLevel token configured for this sub-account yet." }, { status: 501 });

  const payload = channel === "sms"
    ? { type: "SMS", contactId: ghlContactId, message: body }
    : { type: "Email", contactId: ghlContactId, subject: (subject || "").slice(0, 200), html: body };

  try {
    const res = await fetch(`${GHL}/conversations/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-04-15",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return await ghlError(res);
    const json = await res.json().catch(() => ({}));
    const ghlMessageId: string | null =
      json?.messageId ?? json?.message?.id ?? json?.conversationId ?? json?.id ?? null;
    if (!ghlMessageId) console.warn("[ghl/message] send succeeded but no id found in response:", JSON.stringify(json).slice(0, 500));
    return NextResponse.json({ ok: true, ghlMessageId });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "GoHighLevel request failed." }, { status: 502 });
  }
}

async function ghlError(res: Response) {
  const text = await res.text().catch(() => "");
  return NextResponse.json({ error: `GoHighLevel API ${res.status}: ${text.slice(0, 240)}` }, { status: 502 });
}
