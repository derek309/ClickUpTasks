import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isClientVisible } from "@/lib/extensionApi";
import { readGmailHtml } from "@/lib/googleMail";

// An email exactly as it was sent, for the Inbox to show the way Gmail does
// (Derek, 2026-10-01). Read from the mailbox the email is in; the same rule as
// the message itself decides who may see it. The page shows it in a sandboxed
// frame with scripts off, so nothing in the email can run.
// GET ?message=<messages.id>  →  { html } or { html: null } for a plain email.
export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("message") ?? "";
  const { data: row } = await supabaseAdmin.from("messages")
    .select("client_id, gmail_message_id, mailbox_member_id").eq("id", id).maybeSingle();
  if (!row?.gmail_message_id || !row.mailbox_member_id) return NextResponse.json({ html: null });
  const allowed = caller.role === "admin" || row.mailbox_member_id === caller.memberId
    || (row.client_id && (await isClientVisible(caller, row.client_id as string)));
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data: owner } = await supabaseAdmin.from("profiles").select("email").eq("member_id", row.mailbox_member_id).maybeSingle();
  if (!owner?.email) return NextResponse.json({ html: null });
  try {
    const html = await readGmailHtml(owner.email as string, row.gmail_message_id as string);
    return NextResponse.json({ html }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return NextResponse.json({ html: null, note: e instanceof Error ? e.message : "Gmail read failed." });
  }
}
