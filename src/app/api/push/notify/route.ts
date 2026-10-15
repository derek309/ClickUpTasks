import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { pushConfigured, sendPush } from "@/lib/push";
import { teammatePush, teammatePushReason, type NotificationRowLike } from "@/lib/pushPayload";

// The phone half of a notification a teammate's app just made (useNotify's
// notify(): the bell row is written from the browser, so the browser asks for
// the push once the row is saved). Only the notification's own row is read,
// never text from the caller: the caller must be the one who made it, a
// minute or two ago, and it must be a kind worth a push
// (lib/pushPayload teammatePushReason: a direct message, a mention or message,
// a step or task handed over). Anything else is a quiet no.

const FRESH_MS = 5 * 60_000;

export async function POST(req: NextRequest) {
  if (!pushConfigured()) return NextResponse.json({ ok: true, skipped: "not-configured" });
  const caller = await requireUser(req);
  if (!caller?.memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof b?.id === "string" ? b.id.trim() : "";
  if (!id || id.length > 100) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const { data } = await supabaseAdmin.from("notifications")
    .select("id, recipient_id, text, task_id, actor_id, client_id, kind, created_at").eq("id", id).maybeSingle();
  const n = data as (NotificationRowLike & { created_at: string | null }) | null;
  if (!n) return NextResponse.json({ ok: true, skipped: "no-row" });
  if (n.actor_id !== caller.memberId || !n.recipient_id || n.recipient_id === caller.memberId)
    return NextResponse.json({ ok: true, skipped: "not-yours" });
  if (!n.created_at || Date.now() - Date.parse(n.created_at) > FRESH_MS) return NextResponse.json({ ok: true, skipped: "stale" });
  const reason = teammatePushReason(n);
  if (!reason) return NextResponse.json({ ok: true, skipped: "not-pushed" });

  let actorName: string | null = null;
  let clientName: string | null = null;
  if (reason === "dm") {
    const { data: p } = await supabaseAdmin.from("profiles").select("name").eq("member_id", n.actor_id).maybeSingle();
    actorName = ((p as { name?: string } | null)?.name ?? "").trim() || null;
  } else if (n.client_id) {
    const { data: c } = await supabaseAdmin.from("clients").select("name").eq("id", n.client_id).maybeSingle();
    clientName = ((c as { name?: string } | null)?.name ?? "").trim() || null;
  }
  const payload = teammatePush(n, { actorName, clientName });
  const sent = payload ? await sendPush([n.recipient_id], payload) : 0;
  return NextResponse.json({ ok: true, sent });
}
