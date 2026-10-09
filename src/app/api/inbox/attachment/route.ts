import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isClientVisible } from "@/lib/extensionApi";
import { readGmailAttachment } from "@/lib/googleMail";
import { contentDisposition } from "@/lib/contentDisposition";

/* eslint-disable @typescript-eslint/no-explicit-any */

// One file from an email, for a preview or a download in the Inbox (Derek,
// 2026-10-01: "show a preview if there are images"). Files stay in Gmail; this
// reads the one asked for from the mailbox the email is in. Same rule as the
// message itself: your own mailbox, a client you can see, or an admin.
//
// GET ?message=<messages.id>&att=<attachment id on that row>[&download=1]
export async function GET(req: NextRequest) {
  // The Inbox fetches this with its token and shows the bytes as a blob URL;
  // a token in the address would end up in logs.
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const messageId = req.nextUrl.searchParams.get("message") ?? "";
  const attId = req.nextUrl.searchParams.get("att") ?? "";
  const { data: row } = await supabaseAdmin.from("messages")
    .select("client_id, gmail_message_id, mailbox_member_id, attachments").eq("id", messageId).maybeSingle();
  if (!row?.gmail_message_id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const att = ((row.attachments as any[]) ?? []).find((a) => a?.id === attId && a?.gmailAttachmentId);
  if (!att) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const allowed = caller.role === "admin" || (row.mailbox_member_id && row.mailbox_member_id === caller.memberId)
    || (row.client_id && (await isClientVisible(caller, row.client_id as string)));
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // The mailbox it was read from; an older row without one cannot be fetched.
  const { data: owner } = await supabaseAdmin.from("profiles").select("email").eq("member_id", row.mailbox_member_id ?? "-").maybeSingle();
  if (!owner?.email) return NextResponse.json({ error: "This file is only in Gmail." }, { status: 404 });
  try {
    const bytes = await readGmailAttachment(owner.email as string, row.gmail_message_id as string, att.gmailAttachmentId as string);
    // Shown in place only when it is a photo or a PDF. Anything else, an SVG
    // included (it can carry script), is a download, never rendered on this
    // site, whatever type the sender claimed.
    const mime = String(att.mimeType || "").toLowerCase();
    const safeInline = /^image\/(jpeg|png|gif|webp|heic|heif)$/.test(mime) || mime === "application/pdf";
    const download = req.nextUrl.searchParams.get("download") === "1" || !safeInline;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": safeInline ? mime : "application/octet-stream",
        "Content-Disposition": contentDisposition(download ? "attachment" : "inline", String(att.name || "file")),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not read the file." }, { status: 502 });
  }
}
