import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocument, memberLabel, setWorkingFile, NO_STORE } from "@/lib/taskDocumentServer";
import { discardVersionFile, docVersionFile, readPageFile, storePageFile } from "@/lib/taskDocumentFiles";
import { applyTextEdits, cleanEdits, pageText, pageTooBig, PAGE_MAX_BYTES, PAGE_TOO_BIG } from "@/lib/pageHtml";
import type { PageEdit } from "@/lib/pageFrameProtocol";
import { mintFrameTicket } from "@/lib/pageFrameTicket";
import { nameReviewIfDefault } from "@/lib/reviewAutoName";
import { MAX_SET_IMAGES, formatImageSet, parseImageSet, replaceSetFiles, type ImageSetItem } from "@/lib/imageSet";

// The team's side of an HTML review's pages (?kind=page, supabase/task-page-reviews.sql).
// A version can hold up to 10 pages, like two emails in one review (imageSet.ts).
//   POST text/plain         pasted code or an uploaded .html file's text (X-File-Name
//                           names it). Added to the end of the working copy, or with
//                           ?slot=N put in place of page N (it keeps that page's name)
//   POST application/json   { baseBody, edits: { [fileId]: edits } }: the team's own
//                           rewording, on any of a version's pages at once, applied on
//                           the server to each page's text; the pages not reworded carry over
//   GET ?fileId=            { frameUrl } to show a page in the sandboxed frame
//   GET ?fileId=&as=code    a page's HTML as plain text, for Copy code and Download
// A page never renders from here: only /page-frame/[ticket] shows it, sandboxed.

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
  if (Number(req.headers.get("content-length") ?? 0) > PAGE_MAX_BYTES * 2 * MAX_SET_IMAGES) return json({ error: PAGE_TOO_BIG }, 413);
  const actor = { id: user.memberId ?? user.id, label: await memberLabel(user) };
  const current = parseImageSet((doc.body as string) ?? "");

  // Every file stored here, so a request that fails part way leaves none behind.
  const created: string[] = [];
  const undo = async () => { for (const id of created) await discardVersionFile(doc.id, id); };
  let items: ImageSetItem[];

  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    const payload = await req.json().catch(() => null) as { baseBody?: unknown; edits?: unknown } | null;
    const base = parseImageSet(payload?.baseBody);
    const raw = payload?.edits && typeof payload.edits === "object" && !Array.isArray(payload.edits) ? payload.edits as Record<string, unknown> : null;
    if (!base.length || !raw) return json({ error: "Invalid request." }, 400);
    const byFile: [string, PageEdit[]][] = [];
    for (const [fileId, list] of Object.entries(raw)) {
      const edits = cleanEdits(list);
      if (!edits || !base.some((item) => item.file === fileId)) return json({ error: "Invalid request." }, 400);
      if (edits.length) byFile.push([fileId, edits]);
    }
    if (!byFile.length) return json({ error: "Change some text on the page first." }, 400);
    const replaced: Record<string, string> = {};
    for (const [fileId, edits] of byFile) {
      const file = await docVersionFile(doc.id, fileId, "page", false);
      const source = file ? await readPageFile(doc.id, file.id, false) : null;
      if (!file || source === null) { await undo(); return json({ error: "That page is no longer on the review." }, 404); }
      const applied = applyTextEdits(source, edits);
      if (!applied.ok) { await undo(); return json({ error: applied.error }, 409); }
      if (pageTooBig(applied.html)) { await undo(); return json({ error: PAGE_TOO_BIG }, 413); }
      const stored = await storePageFile(doc.id, applied.html, file.name, actor);
      if (!stored.ok) { await undo(); return json({ error: stored.error }, stored.status); }
      created.push(stored.fileId);
      replaced[fileId] = stored.fileId;
    }
    // The pages not reworded stay live: every one of them must still be on the review.
    for (const item of base) {
      if (!replaced[item.file] && !(await docVersionFile(doc.id, item.file, "page", false))) {
        await undo();
        return json({ error: "That page is no longer on the review." }, 404);
      }
    }
    items = replaceSetFiles(base, replaced);
  } else {
    const html = await req.text();
    let name: unknown;
    try { name = decodeURIComponent(req.headers.get("x-file-name") ?? ""); } catch { name = ""; }
    if (!html.trim()) return json({ error: "Paste the page code first." }, 400);
    if (pageTooBig(html)) return json({ error: PAGE_TOO_BIG }, 413);
    const rawSlot = req.nextUrl.searchParams.get("slot");
    const slot = rawSlot === null ? null : Number(rawSlot);
    if (slot !== null && (!Number.isInteger(slot) || !current[slot])) return json({ error: "That page is no longer on the review." }, 404);
    if (slot === null && current.length >= MAX_SET_IMAGES) return json({ error: `A version holds up to ${MAX_SET_IMAGES} pages.` }, 400);
    const stored = await storePageFile(doc.id, html, name, actor);
    if (!stored.ok) return json({ error: stored.error }, stored.status);
    created.push(stored.fileId);
    items = slot !== null
      ? current.map((item, i) => (i === slot ? { file: stored.fileId, label: item.label } : item))
      : [...current, { file: stored.fileId, label: "" }];
  }

  try {
    const data = await setWorkingFile(doc.id, formatImageSet(items), (doc.body as string) ?? "", { updated_by: user.memberId, updated_at: new Date().toISOString() });
    if (data) {
      // Its first page gives a review still called "New HTML review" a name (reviewAutoName.ts).
      const file = await docVersionFile(doc.id, items[0].file, "page", false);
      const named = file ? await nameReviewIfDefault(data, { kind: "page", path: file.path, fileName: file.name }) : null;
      return json({ document: named ?? data, fileIds: created });
    }
  } catch { /* falls through to undo the files */ }
  await undo();
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
