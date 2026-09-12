import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocument, linkState, mintDocLink, revokeDocLink, NO_STORE } from "@/lib/taskDocumentServer";

// The client's private link to a task's review document (or, with ?kind=image,
// its image review).
//   GET     is the link on, and can it be copied
//   POST    { action: "copy" } returns the link; { action: "new" } replaces it
//   DELETE  switches it off for good
// The link table is readable by the server only, so the drawer asks here rather
// than reading it. A URL is only ever returned on an explicit copy or new.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await teamDocument(req, id);
  if (!found.ok) return found.res;
  const state = await linkState(found.doc.id, req.nextUrl.origin);
  return json({ live: state.live, copyable: !!state.url });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await teamDocument(req, id);
  if (!found.ok) return found.res;
  const payload = await req.json().catch(() => null) as { action?: unknown } | null;
  const origin = req.nextUrl.origin;

  if (payload?.action === "copy") {
    const state = await linkState(found.doc.id, origin);
    if (!state.live) return json({ error: "The link is off. Make a new link to share it again." }, 404);
    if (!state.url) return json({ error: "This link can't be copied again. Make a new link instead." }, 409);
    return json({ url: state.url });
  }
  if (payload?.action === "new") {
    // Admin only, like turning on a client's portal link. A new link is bound
    // to the task's client as it is now, which is also how a task moved to
    // another client gets a working link again.
    if (found.user.role !== "admin") return json({ error: "Only an admin can make a new link." }, 403);
    const url = await mintDocLink(found.doc.id, found.task, found.user, origin);
    return json({ url });
  }
  return json({ error: "Invalid request." }, 400);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await teamDocument(req, id);
  if (!found.ok) return found.res;
  // Anyone who can see the task can switch it off: taking a link down is always safe.
  await revokeDocLink(found.doc.id);
  return json({ ok: true });
}
