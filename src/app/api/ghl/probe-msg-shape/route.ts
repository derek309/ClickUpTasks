import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { tokenForLocation } from "@/lib/ghlTokens";

/* eslint-disable @typescript-eslint/no-explicit-any */

// TEMPORARY diagnostic — delete once the email-body path is confirmed.
// Yesterday's probe proved /conversations/messages/email/{id} exists but
// rejects the CONVERSATION message id, so GHL keys email content by a
// separate id. This finds where that id actually lives on a real message
// object (rather than assuming meta.email.messageIds) and then tries the
// fetch with it, so the backfill is built against a verified contract.
//
// Its own throwaway secret, never the live webhook secret.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!process.env.PROBE_SECRET || req.nextUrl.searchParams.get("secret") !== process.env.PROBE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  const ghlContactId = req.nextUrl.searchParams.get("ghlContactId") ?? "";
  if (!locationId || !ghlContactId) return NextResponse.json({ error: "locationId and ghlContactId required" }, { status: 400 });

  const token = await tokenForLocation(locationId);
  if (!token) return NextResponse.json({ error: "No token for location" }, { status: 400 });
  const headers = { Authorization: `Bearer ${token}`, Version: "2021-04-15", Accept: "application/json" };

  const convRes = await fetch(`https://services.leadconnectorhq.com/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(ghlContactId)}&limit=3`, { headers });
  if (!convRes.ok) return NextResponse.json({ step: "conversations/search", status: convRes.status, sample: (await convRes.text()).slice(0, 300) });
  const convs = (await convRes.json())?.conversations ?? [];
  if (!convs.length) return NextResponse.json({ note: "no conversations for this contact" });

  const msgRes = await fetch(`https://services.leadconnectorhq.com/conversations/${encodeURIComponent(convs[0].id)}/messages?limit=20`, { headers });
  if (!msgRes.ok) return NextResponse.json({ step: "messages", status: msgRes.status, sample: (await msgRes.text()).slice(0, 300) });
  const container = (await msgRes.json())?.messages;
  const messages: any[] = Array.isArray(container) ? container : (container?.messages ?? []);

  // Only email messages, and only the ones missing a body — the exact rows
  // the backfill has to repair.
  const emails = messages.filter((m) => m?.messageType === "TYPE_EMAIL");
  const blank = emails.filter((m) => !m?.body);

  const probeTarget = blank[0] ?? emails[0] ?? null;
  let emailFetch: any = null;
  // Try every id-ish candidate on the message so the real one reveals itself.
  const candidateIds: Record<string, unknown> = probeTarget ? {
    "meta.email.messageIds[0]": probeTarget?.meta?.email?.messageIds?.[0],
    "meta.email.messageIds[last]": probeTarget?.meta?.email?.messageIds?.slice?.(-1)?.[0],
    "meta.emailMessageId": probeTarget?.meta?.emailMessageId,
    "altId": probeTarget?.altId,
  } : {};
  for (const [label, id] of Object.entries(candidateIds)) {
    if (!id || typeof id !== "string") continue;
    const r = await fetch(`https://services.leadconnectorhq.com/conversations/messages/email/${encodeURIComponent(id)}`, { headers });
    const txt = await r.text();
    let parsed: any = null; try { parsed = JSON.parse(txt); } catch {}
    emailFetch = {
      label, id, status: r.status,
      topLevelKeys: parsed ? Object.keys(parsed) : null,
      bodyLen: typeof parsed?.body === "string" ? parsed.body.length : null,
      htmlLen: typeof parsed?.htmlBody === "string" ? parsed.htmlBody.length : null,
      innerKeys: parsed?.emailMessage ? Object.keys(parsed.emailMessage) : null,
      sample: txt.slice(0, 200),
    };
    if (r.ok) break; // found the working one
  }

  return NextResponse.json({
    counts: { messages: messages.length, emails: emails.length, blankEmails: blank.length },
    // Structure only, so no customer email content is echoed here.
    sampleMessageKeys: probeTarget ? Object.keys(probeTarget) : null,
    sampleMeta: probeTarget?.meta ?? null,
    candidateIds,
    emailFetch,
  });
}
