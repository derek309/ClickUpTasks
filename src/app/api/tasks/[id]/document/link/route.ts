import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, linkState, mintDocLink, revokeDocLink, NO_STORE } from "@/lib/taskDocumentServer";

// The client's private link to a task's review document.
//   GET     is the link on, and can it be copied
//   POST    { action: "copy" } returns the link; { action: "new" } replaces it
//   DELETE  switches it off for good
// The link table is readable by the server only, so the drawer asks here rather
// than reading it. A URL is only ever returned on an explicit copy or new.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function documentFor(req: NextRequest, id: string) {
  const access = await teamDocAccess(req, id);
  if (!access.ok) return { ok: false as const, res: access.res };
  const { data: doc } = await supabaseAdmin.from("task_documents").select("id").eq("task_id", id).maybeSingle();
  if (!doc) return { ok: false as const, res: json({ error: "This task has no client document yet." }, 404) };
  return { ok: true as const, access, documentId: doc.id as string };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await documentFor(req, id);
  if (!found.ok) return found.res;
  const state = await linkState(found.documentId, req.nextUrl.origin);
  return json({ live: state.live, copyable: !!state.url });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await documentFor(req, id);
  if (!found.ok) return found.res;
  const payload = await req.json().catch(() => null) as { action?: unknown } | null;
  const origin = req.nextUrl.origin;

  if (payload?.action === "copy") {
    const state = await linkState(found.documentId, origin);
    if (!state.live) return json({ error: "The link is off. Make a new link to share it again." }, 404);
    if (!state.url) return json({ error: "This link can't be copied again. Make a new link instead." }, 409);
    return json({ url: state.url });
  }
  if (payload?.action === "new") {
    // Admin only, like turning on a client's portal link. A new link is bound
    // to the task's client as it is now, which is also how a task moved to
    // another client gets a working link again.
    if (found.access.user.role !== "admin") return json({ error: "Only an admin can make a new link." }, 403);
    const url = await mintDocLink(found.documentId, found.access.task, found.access.user, origin);
    return json({ url });
  }
  return json({ error: "Invalid request." }, 400);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const found = await documentFor(req, id);
  if (!found.ok) return found.res;
  // Anyone who can see the task can switch it off: taking a link down is always safe.
  await revokeDocLink(found.documentId);
  return json({ ok: true });
}
