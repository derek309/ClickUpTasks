import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken, canCallerMessageClient } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";
import { googleConfigured } from "@/lib/googleMail";
import { nudgeClientAboutChat } from "@/lib/clientChatNudge";
import { PERSONAL_CLIENT_ID } from "@/lib/data";

// A teammate's reply in a client's portal chat, from the Inboxes Mac app. The
// same `messages` row the web app writes (Cockpit.tsx sendMessage, channel
// "chat"), which the client sees on their /waiting page, then the same
// per-client "you have a new message" email the web app asks for.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!caller.memberId) return NextResponse.json({ error: "This token's account has no roster member id." }, { status: 403 });
  const { id: taskId } = await params;

  const body = await req.json().catch(() => ({}));
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Nothing to send." }, { status: 400 });

  const { data: task } = await supabaseAdmin.from("tasks").select("client_id, contact_id").eq("id", taskId).maybeSingle();
  if (!task) return NextResponse.json({ error: "No such task." }, { status: 404 });
  const clientId = task.client_id as string;
  if (clientId === PERSONAL_CLIENT_ID) return NextResponse.json({ error: "Personal tasks have no client chat." }, { status: 403 });
  if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible task." }, { status: 403 });
  const refusal = await canCallerMessageClient(caller, clientId);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });

  // The task's own contact, else the client's linked one, else the id-derived
  // contact — the same order the portal's messages route uses.
  const { data: client } = await supabaseAdmin.from("clients").select("linked_contact_id").eq("id", clientId).maybeSingle();
  const contactId = (task.contact_id as string | null) || (client?.linked_contact_id as string | null) || (clientId.startsWith("cl_") ? clientId.slice(3) : null);
  if (!contactId) return NextResponse.json({ error: "This client isn't linked to a contact." }, { status: 400 });

  const messageId = "msg_" + randomUUID();
  const { error } = await supabaseAdmin.from("messages").insert({
    id: messageId, contact_id: contactId, client_id: clientId, task_id: taskId, channel: "chat", direction: "outbound",
    subject: null, body: text, created_by: caller.memberId, read: true, attachments: [],
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (googleConfigured) await nudgeClientAboutChat(caller, clientId);
  return NextResponse.json({ ok: true, messageId });
}
