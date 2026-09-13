import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocument, memberLabel, setWorkingFile, NO_STORE } from "@/lib/taskDocumentServer";
import { discardVersionFile, docVersionFile, readPageFile, storePageFile } from "@/lib/taskDocumentFiles";
import { applyTextEdits, cleanEdits, pageText, pageTooBig, PAGE_MAX_BYTES, PAGE_TOO_BIG } from "@/lib/pageHtml";
import { mintFrameTicket } from "@/lib/pageFrameTicket";

// The team's side of a web page review's page (?kind=page, supabase/task-page-reviews.sql).
//   POST text/plain         pasted code or an uploaded .html file's text (X-File-Name
//                           names it) becomes a new version, the one to send next
//   POST application/json   { baseFileId, edits }: the team's own rewording of a
//                           version, applied on the server to that version's text
//   GET ?fileId=            { frameUrl } to show a version in the sandboxed frame
//   GET ?fileId=&as=code    the version's HTML as plain text, for Copy code and Download
// The page never renders from here: only /page-frame/[ticket] shows it, sandboxed.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function open(req: NextRequest, params: Promise<{ id: string }>, columns = "id") {
  if (!adminConfigured) return { ok: false as const, res: json({ error: "Not configured" }, 501) };
  const { id } = await params;
  const found = await teamDocument(req, id, columns);
  if (!found.ok) return found;
  if (found.kind !== "page") return { ok: false as const, res: json({ error: "Invalid request." }, 400) };
  return found;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const found = await open(req, params, "id, approved_at, body");
  if (!found.ok) return found.res;
  const { doc, user } = found;
  if (doc.approved_at) return json({ error: "This page is approved. Reopen it to make changes." }, 409);
  if (Number(req.headers.get("content-length") ?? 0) > PAGE_MAX_BYTES * 2) return json({ error: PAGE_TOO_BIG }, 413);

  let html: string;
  let name: unknown;
  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    const payload = await req.json().catch(() => null) as { baseFileId?: unknown; edits?: unknown } | null;
    const edits = cleanEdits(payload?.edits);
    if (!edits) return json({ error: "Invalid request." }, 400);
    if (!edits.length) return json({ error: "Change some text on the page first." }, 400);
    const base = await docVersionFile(doc.id, payload?.baseFileId, "page", false);
    const source = base ? await readPageFile(doc.id, base.id, false) : null;
    if (!base || source === null) return json({ error: "That version is no longer on the review." }, 404);
    const applied = applyTextEdits(source, edits);
    if (!applied.ok) return json({ error: applied.error }, 409);
    html = applied.html;
    name = base.name;
  } else {
    html = await req.text();
    try { name = decodeURIComponent(req.headers.get("x-file-name") ?? ""); } catch { name = ""; }
    if (!html.trim()) return json({ error: "Paste the page code first." }, 400);
  }
  if (pageTooBig(html)) return json({ error: PAGE_TOO_BIG }, 413);

  const stored = await storePageFile(doc.id, html, name, { id: user.memberId ?? user.id, label: await memberLabel(user) });
  if (!stored.ok) return json({ error: stored.error }, stored.status);
  try {
    const data = await setWorkingFile(doc.id, stored.fileId, (doc.body as string) ?? "", { updated_by: user.memberId, updated_at: new Date().toISOString() });
    if (data) return json({ document: data, fileId: stored.fileId });
  } catch { /* falls through to undo the file */ }
  await discardVersionFile(doc.id, stored.fileId);
  return json({ error: "This page is approved. Reopen it to make changes." }, 409);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const found = await open(req, params);
  if (!found.ok) return found.res;
  const fileId = req.nextUrl.searchParams.get("fileId");
  const as = req.nextUrl.searchParams.get("as");
  if (as === "code" || as === "text") {
    const html = await readPageFile(found.doc.id, fileId, false);
    if (html === null) return json({ error: "That version is no longer on the review." }, 404);
    // The words a person reads, for the History diff.
    if (as === "text") return json({ text: pageText(html) });
    return new NextResponse(html, { headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
  }
  const file = await docVersionFile(found.doc.id, fileId, "page", false);
  if (!file) return json({ error: "That version is no longer on the review." }, 404);
  const ticket = mintFrameTicket(found.doc.id, file.id);
  if (!ticket) return json({ error: "Page previews are not set up on this server." }, 501);
  return json({ frameUrl: `/page-frame/${ticket}` });
}
