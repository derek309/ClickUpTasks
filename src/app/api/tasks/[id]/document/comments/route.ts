import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, memberLabel, NO_STORE } from "@/lib/taskDocumentServer";
import { postDocComment } from "@/lib/taskDocumentFiles";

// A teammate comments on a task's client document. The thread is shared, so the
// client reads it on their review page the next time it refreshes. The team
// reads the thread through row level security (db.ts).

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const { data: doc } = await supabaseAdmin.from("task_documents").select("id").eq("task_id", id).maybeSingle();
  if (!doc) return json({ error: "This task has no client document yet." }, 404);
  const payload = await req.json().catch(() => null) as { body?: unknown } | null;
  const user = access.user;
  const r = await postDocComment(doc.id as string, payload?.body, { id: user.memberId ?? user.id, label: await memberLabel(user) });
  return r.ok ? json({ comment: r.comment }) : json({ error: r.error }, r.status);
}
