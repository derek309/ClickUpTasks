import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { googleConfigured } from "@/lib/googleMail";
import { nudgeClientAboutChat } from "@/lib/clientChatNudge";
import { PERSONAL_CLIENT_ID } from "@/lib/data";

// Best-effort "you have a new message" nudge for a chat-channel reply — the
// reply itself is just a `messages` row (see Cockpit.tsx's sendMessage,
// channel: "chat" branch), nothing the client sees outside the app unless
// told to look. Unlike the internal self-notify emails elsewhere in this
// app, this recipient is a real external client and this sender is a real
// team member's own address — a reply to THIS email is a normal, working
// reply, not a dead end, so no "do not reply" warning belongs here.
export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!googleConfigured) return NextResponse.json({ ok: true, skipped: "not-configured" });

  const b = await req.json().catch(() => null) as { clientId?: string; taskId?: string } | null;
  const { clientId, taskId } = b ?? {};
  if (!clientId || !taskId) return NextResponse.json({ error: "Missing clientId or taskId." }, { status: 400 });
  // Never mint a share token for the "personal" pseudo-client — every
  // teammate's private tasks carry that client_id, and the waiting page
  // selects by client_id, so one token would publish all of them. Refused
  // here as well as in the UI (Cockpit's getClientShareUrl) because this
  // route mints with the service role regardless of the caller's rights.
  if (clientId === PERSONAL_CLIENT_ID) return NextResponse.json({ error: "Personal tasks can't be shared." }, { status: 403 });

  if (caller.role !== "admin") {
    if (!caller.canSendMessages) return NextResponse.json({ error: "You don't have permission to send messages." }, { status: 403 });
    const { data: clientRow } = await supabaseAdmin.from("clients").select("can_message").eq("id", clientId).maybeSingle();
    const allowed = ((clientRow?.can_message as string[] | null) ?? []).includes(caller.memberId ?? "");
    if (!allowed) return NextResponse.json({ error: "You don't have permission to message this client." }, { status: 403 });
  }

  const skipped = await nudgeClientAboutChat(caller, clientId);
  if (skipped === "not-found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (skipped) return NextResponse.json({ ok: true, skipped });

  return NextResponse.json({ ok: true, taskId });
}
