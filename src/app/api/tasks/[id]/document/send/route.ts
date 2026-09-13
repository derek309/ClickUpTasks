import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
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
  return json({ version: r.version, url: r.url, linkLive: true });
}
