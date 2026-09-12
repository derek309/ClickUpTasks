import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { DOC_TOKEN_PATTERN, NO_STORE, docNotFound, resolveDocToken, readPublicJson } from "@/lib/taskDocumentServer";

// Public, no login: the client's review page reports that it was opened, so the
// team sees "Viewed 2h ago" on the document (Derek, 2026-09-11). The page sends
// this once it has been on screen for a few seconds; the link's GET never counts,
// since mail scanners open links before the client does. The team sees it the
// next time the document loads; a view is not worth a line on the task.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { token } = await params;
  if (!DOC_TOKEN_PATTERN.test(token)) return docNotFound();
  const limited = await rateLimit(req, token, "doc_view");
  if (limited) return limited;
  const read = await readPublicJson(req);
  if (!read.ok) return read.res;
  const scope = await resolveDocToken(token);
  if (!scope) return docNotFound();
  await supabaseAdmin.from("task_documents").update({ client_viewed_at: new Date().toISOString() }).eq("id", scope.documentId);
  return json({ ok: true });
}
