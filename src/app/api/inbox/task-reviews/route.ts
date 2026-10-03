import { NextRequest, NextResponse } from "next/server";
import { requireUser, callerCanSeeTask } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { linkState, reviewTask, NO_STORE } from "@/lib/taskDocumentServer";
import { kindTitle, parseKind } from "@/lib/reviewKinds";

// The task's reviews whose client link is on, with that link, for Insert from
// task in the Inbox email box (Derek, 2026-10-02). The link goes into an email
// to the client the conversation is with, so only someone who can see the
// task gets them, as with Copy link in the drawer.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const caller = await requireUser(req);
  if (!caller) return json({ error: "Unauthorized" }, 401);
  const taskId = req.nextUrl.searchParams.get("task") ?? "";
  if (!taskId || !(await callerCanSeeTask(req, taskId))) return json({ error: "Not found" }, 404);
  if (!(await reviewTask(taskId)).ok) return json({ reviews: [] });
  const { data: docs } = await supabaseAdmin.from("task_documents")
    .select("id, kind, title, status, client_viewed_at").eq("task_id", taskId).is("deleted_at", null);
  const reviews = [];
  for (const d of docs ?? []) {
    if (d.status === "draft") continue;
    const link = await linkState(d.id as string, req.nextUrl.origin);
    if (!link.live || !link.url) continue;
    const kind = parseKind(d.kind);
    reviews.push({ id: d.id, kind, name: (d.title as string | null)?.trim() || kindTitle(kind), url: link.url, opened: !!d.client_viewed_at, status: d.status });
  }
  return json({ reviews });
}
