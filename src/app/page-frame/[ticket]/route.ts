import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { readPageFile } from "@/lib/taskDocumentFiles";
import { readFrameTicket } from "@/lib/pageFrameTicket";
import { framePage } from "@/lib/pageHtml";

// The one place a web page review's page is ever shown (supabase/task-page-reviews.sql).
// It is someone else's HTML, so it must never run with this app's origin: the
// team's sign in lives in this origin's localStorage. The CSP sandbox header gives
// the page an opaque origin even if this address is opened directly, and the
// iframe that loads it is sandboxed too (PageReviewFrame.tsx). No frame-ancestors
// or X-Frame-Options here: the app itself runs inside a GoHighLevel iframe.
//
// The address holds only a 30 minute ticket for this one file (pageFrameTicket.ts),
// never a document link. The page is served with every element numbered and the
// bridge script first in its head (pageHtml.ts framePage, public/page-bridge.js).

const FRAME_HEADERS = {
  "Content-Security-Policy": "sandbox allow-scripts; base-uri 'none'; object-src 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

const gone = (status: number) => new NextResponse("This page is no longer available. Reload the review to see it again.", {
  status, headers: { ...FRAME_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticket: string }> }) {
  if (!adminConfigured) return gone(501);
  const { ticket } = await params;
  const opened = readFrameTicket(ticket);
  if (!opened) return gone(404);
  const limited = await rateLimit(req, ticket, "page_frame");
  if (limited) return limited;
  const html = await readPageFile(opened.documentId, opened.fileId, false);
  if (html === null) return gone(404);
  const bridge = `<script src="${req.nextUrl.origin}/page-bridge.js"></script>`;
  return new NextResponse(framePage(html, bridge), { headers: { ...FRAME_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
}
