import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { htmlToText, type Attachment } from "@/lib/data";
import { TASK_FILES_BUCKET } from "@/lib/db";

// Public, deliberately unauthenticated — the first route of its kind in this
// app. Backs /waiting/[token], a client-facing page showing "here's what
// we're waiting on you for" (see supabase/client-share-token.sql). The
// token itself IS the access control: it's a 122-bit random value, matched
// on clients.share_token, and this route only ever returns that one
// client's name plus its own tasks — no assignee names, comments, or any
// other client's data reaches this response, on purpose.
//
// A task appears here while it's still waiting on the client, OR once the
// client has submitted a response (see ./respond/route.ts) — kept visible
// through "submitted, the team's on it" and "done" so the client can watch
// it through to completion instead of it silently vanishing once answered.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: client } = await supabaseAdmin.from("clients").select("id, name").eq("share_token", token).maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  type Row = { id: string; title: string; due: string | null; description: string | null; status: string; waiting_on_client: boolean | null; client_response: { body: string; attachments: Attachment[]; submittedAt: string } | null };
  const cols = "id, title, due, description, status, waiting_on_client, client_response";
  const [{ data: waiting }, { data: responded }] = await Promise.all([
    supabaseAdmin.from("tasks").select(cols).eq("client_id", client.id).eq("waiting_on_client", true),
    supabaseAdmin.from("tasks").select(cols).eq("client_id", client.id).not("client_response", "is", null),
  ]);
  const byId = new Map<string, Row>();
  [...(waiting ?? []), ...(responded ?? [])].forEach((t) => byId.set((t as Row).id, t as Row));
  const rows = [...byId.values()].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));

  const tasks = await Promise.all(rows.map(async (t) => {
    const cr = t.client_response as { body: string; attachments: Attachment[]; submittedAt: string } | null;
    const attachments = cr
      ? await Promise.all(cr.attachments.map(async (a) => ({
          id: a.id, name: a.name, kind: a.kind, size: a.size, path: a.path ?? null,
          url: a.path ? (await supabaseAdmin.storage.from(TASK_FILES_BUCKET).createSignedUrl(a.path, 3600)).data?.signedUrl ?? null : a.url ?? null,
        })))
      : [];
    return {
      id: t.id, title: t.title, due: t.due ?? null,
      // Stripped to plain text server-side — no HTML ever reaches this public
      // response, and the page never needs the TipTap editor bundle to render it.
      description: htmlToText(t.description ?? ""),
      status: t.status, needsResponse: t.waiting_on_client === true,
      response: cr ? { body: cr.body, submittedAt: cr.submittedAt, attachments } : null,
    };
  }));

  return NextResponse.json({ clientName: client.name, tasks });
}
