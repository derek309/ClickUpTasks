import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocument, memberLabel, NO_STORE } from "@/lib/taskDocumentServer";
import { startDocUpload, finishDocUpload, removeDocFile } from "@/lib/taskDocumentFiles";
import { kindWhat } from "@/lib/reviewKinds";

// The team adds and removes files on a task's client document. The client sees a
// new file on their review page straight away; removing one takes it away too.
// On an image review, { purpose: "image" } uploads a new version of the image,
// and on a video review { purpose: "video" } a new version of the video, which
// the client sees once it is sent.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function open(req: NextRequest, params: Promise<{ id: string }>) {
  if (!adminConfigured) return { ok: false as const, res: json({ error: "Not configured" }, 501) };
  const { id } = await params;
  const found = await teamDocument(req, id, "id, approved_at");
  if (!found.ok) return found;
  if (found.doc.approved_at) return { ok: false as const, res: json({ error: `This ${kindWhat(found.kind)} is approved. Reopen it to change its files.` }, 409) };
  const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") return { ok: false as const, res: json({ error: "Invalid request." }, 400) };
  const user = found.user;
  return {
    ok: true as const, documentId: found.doc.id, payload,
    // A review's own version file only through its own kind's review; anything
    // else on the document is a plain file in the Files list.
    purpose: (found.kind === "image" && payload.purpose === "image") || (found.kind === "video" && payload.purpose === "video")
      ? found.kind : "file" as const,
    actor: { id: user.memberId ?? user.id, label: await memberLabel(user) },
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  if (o.payload.action === "start") {
    const r = await startDocUpload(o.documentId, o.payload.name, o.payload.size, o.purpose);
    return r.ok ? json({ path: r.path, uploadUrl: r.uploadUrl }) : json({ error: r.error }, r.status);
  }
  if (o.payload.action === "confirm") {
    const r = await finishDocUpload(o.documentId, o.payload.path, o.payload.name, o.actor, o.purpose);
    return r.ok ? json({ ok: true, fileId: r.fileId }) : json({ error: r.error }, r.status);
  }
  return json({ error: "Invalid request." }, 400);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const o = await open(req, params);
  if (!o.ok) return o.res;
  const r = await removeDocFile(o.documentId, o.payload.fileId, o.actor, false);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}
