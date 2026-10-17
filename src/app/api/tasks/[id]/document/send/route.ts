import { NextRequest, NextResponse } from "next/server";
import { adminConfigured, supabaseAdmin } from "@/lib/supabaseAdmin";
import { teamDocAccess, teamActor, kindOf, NO_STORE } from "@/lib/taskDocumentServer";
import { sendReview } from "@/lib/reviewService";

// Send for review: the team's working copy becomes the next version the client
// sees, and the first send turns on the client's private link (admin only; see
// sendReview). The drawer then moves the task to Waiting through its normal task
// update, so the stage change, the waiting sync and the live update all take the
// usual path.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;

  const payload = await req.json().catch(() => null) as { baseVersion?: unknown } | null;
  const baseVersion = payload?.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion)) return json({ error: "Invalid request." }, 400);

  const r = await sendReview(access.task, kindOf(req), teamActor(access.user), baseVersion, req.nextUrl.origin);
  if (!r.ok) return json({ error: r.error, current: r.current ?? null }, r.status);
  // The steps the send made on the server (the client's waiting step) come
  // back with it, so the task page shows them instead of adding its own copy
  // (2026-10-17: two "Waiting on Brian's approval" 0.4s apart, one from here
  // and one from the page, both kept by the save's merge).
  const { data } = await supabaseAdmin.from("tasks").select("subtasks").eq("id", id).maybeSingle();
  return json({ version: r.version, url: r.url, linkLive: true, subtasks: (data as { subtasks?: unknown } | null)?.subtasks ?? null });
}
