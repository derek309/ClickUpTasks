import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamActor } from "@/lib/taskDocumentServer";
import { NO_STORE, briefLinkState, extendBriefLink, mintBriefLink, revokeBriefLink, teamBrief } from "@/lib/briefServer";

// The outside link to a task's project instructions.
//   GET     is it on, until when, and can it be copied
//   POST    { action: "copy" } the link; { action: "new", days } a fresh one;
//           { action: "extend", days } the same link for longer from today
//   DELETE  switches it off for good
// Any teammate who can see the task may make one: the instructions carry no
// contact details and act as nobody, unlike the client's review link.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await teamBrief(req, id);
  if (!found.ok) return found.res;
  const s = await briefLinkState(found.brief.id as string, req.nextUrl.origin);
  return json({ live: s.live, copyable: !!s.url, expiresAt: s.expiresAt });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await teamBrief(req, id);
  if (!found.ok) return found.res;
  const payload = await req.json().catch(() => null) as { action?: unknown; days?: unknown } | null;
  const briefId = found.brief.id as string;
  const origin = req.nextUrl.origin;

  if (payload?.action === "copy") {
    const s = await briefLinkState(briefId, origin);
    if (!s.live) return json({ error: "The link is off. Make a new link to share it again." }, 404);
    if (!s.url) return json({ error: "This link can't be copied again. Make a new link instead." }, 409);
    return json({ url: s.url, expiresAt: s.expiresAt });
  }
  if (payload?.action === "new") {
    const s = await mintBriefLink(briefId, id, teamActor(found.user), origin, payload.days);
    return json({ url: s.url, expiresAt: s.expiresAt });
  }
  if (payload?.action === "extend") {
    if (!(await extendBriefLink(briefId, payload.days))) return json({ error: "The link is off. Make a new link instead." }, 404);
    const s = await briefLinkState(briefId, origin);
    return json({ live: s.live, copyable: !!s.url, expiresAt: s.expiresAt });
  }
  return json({ error: "Invalid request." }, 400);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await teamBrief(req, id);
  if (!found.ok) return found.res;
  await revokeBriefLink(found.brief.id as string);
  return json({ ok: true });
}
