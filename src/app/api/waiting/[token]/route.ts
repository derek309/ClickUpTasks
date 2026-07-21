import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { htmlToText } from "@/lib/data";

// Public, deliberately unauthenticated — the first route of its kind in this
// app. Backs /waiting/[token], a client-facing page showing "here's what
// we're waiting on you for" (see supabase/client-share-token.sql). The
// token itself IS the access control: it's a 122-bit random value, matched
// on clients.share_token, and this route only ever returns that one
// client's name plus its own open waitingOnClient tasks — no assignee
// names, comments, attachments, or any other client's data reaches this
// response, on purpose.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: client } = await supabaseAdmin.from("clients").select("id, name").eq("share_token", token).maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: tasks } = await supabaseAdmin
    .from("tasks")
    .select("id, title, due, description")
    .eq("client_id", client.id)
    .eq("waiting_on_client", true)
    .neq("status", "done")
    .order("due", { ascending: true, nullsFirst: false });

  return NextResponse.json({
    clientName: client.name,
    // Stripped to plain text server-side — no HTML ever reaches this public
    // response, and the page never needs the TipTap editor bundle to render it.
    tasks: (tasks ?? []).map((t) => ({ id: t.id, title: t.title, due: t.due ?? null, description: htmlToText(t.description ?? "") })),
  });
}
