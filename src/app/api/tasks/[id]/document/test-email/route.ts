import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocument, NO_STORE } from "@/lib/taskDocumentServer";
import { readPageFile } from "@/lib/taskDocumentFiles";
import { googleConfigured, sendGmailAs } from "@/lib/googleMail";
import { parseImageSet } from "@/lib/imageSet";
import { readReviewMeta } from "@/lib/htmlReview";

// Send me a test (Derek, 2026-10-15, html-review-mockup.html): an Email review's
// page goes to the signed in teammate's own inbox, from their own address, with
// the review's subject and preview text, so they see it the way a reader will.
// It only ever goes to the person who pressed it, never to a client: there is no
// address in the request at all. POST { fileId } picks one page of the working
// copy (the first when left out).

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const SEND_DOMAIN = "clickuplocal.com";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The preview text as an inbox reads it: hidden first words in the body. */
function withPreviewText(html: string, preview: string): string {
  if (!preview) return html;
  const hidden = `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preview)}</div>`;
  const body = /<body[^>]*>/i.exec(html);
  return body ? html.slice(0, body.index + body[0].length) + hidden + html.slice(body.index + body[0].length) : hidden + html;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await teamDocument(req, id, "id, title, body, picks");
  if (!found.ok) return found.res;
  if (found.kind !== "page") return json({ error: "Invalid request." }, 400);
  if (!googleConfigured) return json({ error: "Sending email is not set up on this server." }, 501);
  // Only to yourself, from yourself, and only a Workspace address can send.
  const me = found.user.email.trim().toLowerCase();
  if (!me.endsWith(`@${SEND_DOMAIN}`)) return json({ error: `Test emails go from your @${SEND_DOMAIN} address, and you aren't signed in with one.` }, 403);

  const raw = await req.json().catch(() => null) as { fileId?: unknown } | null;
  const items = parseImageSet(String(found.doc.body ?? ""));
  const fileId = typeof raw?.fileId === "string" && items.some((x) => x.file === raw.fileId) ? raw.fileId : items[0]?.file;
  if (!fileId) return json({ error: "There is no page to send yet." }, 400);
  const html = await readPageFile(found.doc.id, fileId, false);
  if (html === null) return json({ error: "That page is no longer on the review." }, 404);

  const meta = readReviewMeta(found.doc.picks);
  const subject = meta.subject?.trim() || String(found.doc.title ?? "").trim() || found.task.title;
  try {
    await sendGmailAs(me, { to: me, subject, body: withPreviewText(html, meta.previewText?.trim() ?? ""), isHtml: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Could not send the test." }, 502);
  }
  return json({ ok: true, to: me });
}
