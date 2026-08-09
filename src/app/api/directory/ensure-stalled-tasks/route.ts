import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { normalizeState, STEP_STALL_DAYS, todayIso } from "@/lib/data";
import { isDue } from "@/lib/plannerPools";
import { upsertConversationTask } from "@/lib/ghlConversationTask";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Ensures a Conversation task exists for every stalled claimed+ business in a
// territory. "Keep them moving" on Follow Up (a business whose Playbook
// hasn't moved in STEP_STALL_DAYS+) used to be a pure computed signal with
// nothing behind it — clicking into the business showed no task explaining
// why it was there (Derek, 2026-08-09: "when I click in there is not task or
// anything for them?"). Every other Follow Up tier is task-backed; this
// closes the one gap. Purely Supabase-driven (no WP call needed — the
// staleness signal lives entirely on the client row already), called from
// Follow Up's own load, same per-territory cooldown pattern as
// ensure-engagement-tasks.
const STALL_ELIGIBLE = new Set(["claimed", "interview", "onboarding"]);

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const city = String(body?.city ?? "").trim();
  const state = String(body?.state ?? "").trim();
  if (!city) return NextResponse.json({ error: "city is required" }, { status: 400 });

  const wantCity = city.trim().toLowerCase();
  const wantState = normalizeState(state);
  const { data: contactRows } = await supabaseAdmin.from("contacts").select("id, name, city, state, ghl_contact_id");
  const matched = (contactRows ?? []).filter((c: any) => c.city && String(c.city).trim().toLowerCase() === wantCity && normalizeState(c.state ?? "") === wantState);
  if (!matched.length) return NextResponse.json({ ok: true, ensured: 0 });

  const clientIds = matched.map((c: any) => "cl_" + c.id);
  const { data: clientRows } = await supabaseAdmin.from("clients").select("id, status, type, playbook_last_progress_at").in("id", clientIds);
  const clientById = new Map((clientRows ?? []).map((c: any) => [c.id, c]));

  const today = todayIso();
  let ensured = 0;
  for (const contact of matched) {
    const client = clientById.get("cl_" + contact.id);
    if (!client || client.type === "client" || !STALL_ELIGIBLE.has(client.status)) continue;
    // A null playbook_last_progress_at means "never started," not "stalled"
    // — a business bulk-promoted moments ago with zero progress isn't
    // overdue, it just hasn't begun. Only a real, actually-old timestamp
    // counts (isDue treats null as always-due, which is right for its other
    // callers but wrong here).
    if (!client.playbook_last_progress_at) continue;
    if (!isDue(client.playbook_last_progress_at, today, STEP_STALL_DAYS)) continue;
    const { data: openTask } = await supabaseAdmin.from("tasks").select("id").eq("client_id", client.id).eq("priority", "conversation").neq("status", "done").limit(1).maybeSingle();
    if (openTask) continue; // a real signal already has this covered — don't compete with it
    const ok = await upsertConversationTask(
      { id: contact.id, name: contact.name, client_id: client.id },
      contact.ghl_contact_id || "",
      { title: `Quiet ${STEP_STALL_DAYS}+ days on the Playbook — check in` },
    );
    if (ok) ensured++;
  }

  return NextResponse.json({ ok: true, ensured });
}
