import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { visibleClientIds } from "@/lib/extensionApi";

// "Has this page already been clipped?" — looks for open tasks carrying the
// given URL as their source-link attachment, so the Clipper can show you the
// existing task instead of quietly making a fifth copy of it (Derek clipped
// one email five times while testing and then spent a while deleting tasks
// that looked like they kept coming back).
//
// Matched on the attachment the create route writes: { kind: "link", url }.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const link = req.nextUrl.searchParams.get("link");
  if (!link) return NextResponse.json({ error: "Missing link." }, { status: 400 });

  // jsonb containment: rows whose attachments array holds an object with this
  // exact url. Indexed or not, the row count here is small and this is a
  // one-shot lookup on panel open, not something on a hot path.
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("id, title, status, client_id")
    .contains("attachments", [{ url: link }])
    .is("deleted_at", null)
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Same visibility rule as every other extension route: a VA must not learn
  // that a task exists on a client they can't see.
  const visible = await visibleClientIds(caller);
  const tasks = (data ?? [])
    .filter((t) => visible === "all" || visible.has(t.client_id as string))
    .map((t) => ({ id: t.id, title: t.title, status: t.status, clientId: t.client_id }));
  return NextResponse.json({ tasks });
}
