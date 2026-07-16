import { NextRequest, NextResponse } from "next/server";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const { clientId, locationId, ghlContactId, channel, subject, body, attachments, cc, bcc } = b as {
    clientId?: string;
    locationId?: string;
    ghlContactId?: string;
    channel?: string;
    subject?: string;
    body?: string;
    attachments?: string[]; // publicly-fetchable URLs — GHL fetches these itself, not a file upload
    cc?: string[]; // email addresses — email channel only; GHL fields emailCc/emailBcc
    bcc?: string[];
  };

  if (!clientId || !locationId || !ghlContactId || !body?.trim())
    return NextResponse.json({ error: "Missing clientId, locationId, ghlContactId, or body." }, { status: 400 });

  // Sending is gated two ways for a non-admin: the global grant
  // (profiles.can_send_messages) AND this specific client's can_message
  // roster (supabase/client-message-permission.sql). Enforced here, not
  // just hidden in the UI, so it can't be bypassed by calling the endpoint
  // directly. Admins always pass both checks implicitly.
  if (caller.role !== "admin") {
    if (!caller.canSendMessages) return NextResponse.json({ error: "You don't have permission to send messages. Ask an admin to enable it for you." }, { status: 403 });
    const { data: clientRow } = await supabaseAdmin.from("clients").select("can_message").eq("id", clientId).maybeSingle();
    const allowed = ((clientRow?.can_message as string[] | null) ?? []).includes(caller.memberId ?? "");
    if (!allowed) return NextResponse.json({ error: "You don't have permission to message this client. Ask an admin to enable it for you." }, { status: 403 });
  }

  const token = await tokenForLocation(locationId);
  if (!token)
    return NextResponse.json({ error: "No GoHighLevel token configured for this sub-account yet." }, { status: 501 });

  const attachmentUrls = attachments?.length ? attachments : undefined;
  const ccList = cc?.filter((e) => e?.trim());
  const bccList = bcc?.filter((e) => e?.trim());
  const payload = channel === "sms"
    ? { type: "SMS", contactId: ghlContactId, message: body, ...(attachmentUrls ? { attachments: attachmentUrls } : {}) }
    : { type: "Email", contactId: ghlContactId, subject: (subject || "").slice(0, 200), html: body,
        ...(attachmentUrls ? { attachments: attachmentUrls } : {}),
        ...(ccList?.length ? { emailCc: ccList } : {}),
        ...(bccList?.length ? { emailBcc: bccList } : {}) };

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
