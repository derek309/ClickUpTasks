import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, teamSend, linkState, mintDocLink, NO_STORE } from "@/lib/taskDocumentServer";

// Send for review: the team's working copy becomes the next version the client
// sees, and the first send turns on the client's private link. The drawer then
// moves the task to Waiting through its normal task update, so the stage
// change, the waiting sync and the live update all take the usual path.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;

  const payload = await req.json().catch(() => null) as { baseVersion?: unknown } | null;
  const baseVersion = payload?.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion)) return json({ error: "Invalid request." }, 400);

  const { data: doc } = await supabaseAdmin.from("task_documents").select("id").eq("task_id", id).is("deleted_at", null).maybeSingle();
  if (!doc) return json({ error: "This task has no client document yet." }, 404);

  // Turning a link on is admin only, the same rule as a client's portal link.
  // Checked before publishing, so a send that cannot reach the client never
  // leaves a version behind.
  const origin = req.nextUrl.origin;
  const link = await linkState(doc.id, origin);
  if (!link.live && access.user.role !== "admin") {
    return json({ error: "Ask an admin to send this the first time. That turns on the client's link." }, 403);
  }

  const outcome = await teamSend(doc.id, baseVersion, access.user);
  if (!outcome.ok) return json({ error: outcome.error, current: outcome.current ?? null }, outcome.status);

  const url = link.live ? link.url : await mintDocLink(doc.id, access.task, access.user, origin);
  return json({ version: outcome.version, url, linkLive: true });
}
