import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { resolveWaitingToken } from "@/lib/waitingToken";
import { readGmailAttachment } from "@/lib/googleMail";

// Public, by the client's portal link: a file on an email that stays in Gmail
// (a photo they emailed), so their conversation shows it instead of a bare
// file name (Derek, 2026-10-08). Only for a message on one of this client's
// own shared tasks (and its list, for a list link), never a private one.
// GET ?message=<messages.id>&att=<attachment id>

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await rateLimit(req, token, "read");
  if (limited) return limited;
  const scope = await resolveWaitingToken(token);
  if (!scope) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const messageId = req.nextUrl.searchParams.get("message") ?? "";
  const attId = req.nextUrl.searchParams.get("att") ?? "";
  const { data: m } = await supabaseAdmin.from("messages").select("client_id, task_id, gmail_message_id, mailbox_member_id, attachments, peer_name").eq("id", messageId).maybeSingle();
  if (!m || m.client_id !== scope.clientId || !m.task_id || !m.gmail_message_id || m.peer_name === "ClickUpTasks") return NextResponse.json({ error: "Not found" }, { status: 404 });
  let q = supabaseAdmin.from("tasks").select("id").eq("id", m.task_id as string).eq("client_id", scope.clientId).eq("is_private", false).is("deleted_at", null);
  if (scope.projectId) q = q.eq("project_id", scope.projectId);
  const { data: task } = await q.maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const att = ((m.attachments as { id: string; name?: string; mimeType?: string; gmailAttachmentId?: string }[] | null) ?? []).find((a) => a.id === attId && a.gmailAttachmentId);
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: owner } = await supabaseAdmin.from("profiles").select("email").eq("member_id", (m.mailbox_member_id as string | null) ?? "-").maybeSingle();
  if (!owner?.email) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const bytes = await readGmailAttachment(owner.email as string, m.gmail_message_id as string, att.gmailAttachmentId!);
    const name = (att.name ?? "file").replace(/[^\w.\- ]+/g, "_");
    // Shown in the page only when it is a picture or a PDF; anything else
    // (an HTML file, an SVG) downloads, so nothing from an email runs here.
    const type = (att.mimeType ?? "").toLowerCase();
    const safe = /^image\/(png|jpe?g|gif|webp|heic|heif)$/.test(type) || type === "application/pdf";
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": safe ? type : "application/octet-stream",
      "Content-Disposition": `${safe ? "inline" : "attachment"}; filename="${name}"`,
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "Could not read that file." }, { status: 502 });
  }
}
