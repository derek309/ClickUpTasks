import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { tokenHealth } from "@/lib/ghlLocate";
import { isRealGhlId } from "@/lib/ghlMatch";
import { GHL_CONFIRM_SINCE, GHL_CONFIRM_GRACE_MS } from "@/lib/data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// What has not reached GoHighLevel, for the Integrations tab in Settings.
// Same rule as the "Not in GoHighLevel" flag on a message (data.ts
// ghlConfirmState): an email, text or call from launch day on, over an hour
// old, with no real GoHighLevel id. Split three ways because each has a
// different fix:
// - missing, by teammate: the outbound ones say who has not connected Gmail
//   sync in their GoHighLevel profile.
// - cannot be confirmed: the contact has no GoHighLevel contact id, so there
//   is nothing to look for until they are saved there.
// - tokens: a sub-account whose token GoHighLevel rejects stops the pull for
//   everyone in it.
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller || caller.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cutoff = new Date(Date.now() - GHL_CONFIRM_GRACE_MS).toISOString();
  const { data: rows } = await supabaseAdmin
    .from("messages").select("contact_id, client_id, direction, created_by, ghl_message_id")
    .in("channel", ["email", "sms", "call"])
    .gte("created_at", GHL_CONFIRM_SINCE).lt("created_at", cutoff)
    .limit(5000);
  const open = (rows ?? []).filter((r: any) => !isRealGhlId(r.ghl_message_id));

  const contactIds = [...new Set(open.map((r: any) => r.contact_id as string).filter(Boolean))];
  const contacts = new Map<string, { name: string; ghl: string | null }>();
  if (contactIds.length) {
    const { data } = await supabaseAdmin.from("contacts").select("id, name, ghl_contact_id").in("id", contactIds);
    for (const c of data ?? []) contacts.set(c.id as string, { name: c.name as string, ghl: (c.ghl_contact_id as string | null) ?? null });
  }

  let missing = 0, inbound = 0;
  const byTeammate = new Map<string, number>();
  const unconfirmable = new Map<string, { contactId: string; clientId: string; name: string; count: number }>();
  for (const r of open as any[]) {
    const c = contacts.get(r.contact_id);
    if (!c?.ghl) {
      const u = unconfirmable.get(r.contact_id) ?? { contactId: r.contact_id, clientId: r.client_id, name: c?.name ?? "Unknown contact", count: 0 };
      u.count++;
      unconfirmable.set(r.contact_id, u);
      continue;
    }
    missing++;
    if (r.direction === "inbound") inbound++;
    else byTeammate.set(r.created_by ?? "", (byTeammate.get(r.created_by ?? "") ?? 0) + 1);
  }

  // Name each sub-account from its own client row, the one place its
  // ghl_location_id really is a location id.
  const tokens = await tokenHealth();
  const { data: subs } = await supabaseAdmin.from("clients").select("name, ghl_location_id").in("ghl_location_id", tokens.map((t) => t.locationId));
  const nameOf = new Map((subs ?? []).map((s: any) => [s.ghl_location_id as string, s.name as string]));

  return NextResponse.json({
    since: GHL_CONFIRM_SINCE,
    missing,
    inbound,
    byTeammate: [...byTeammate].map(([memberId, count]) => ({ memberId: memberId || null, count })).sort((a, b) => b.count - a.count),
    unconfirmable: [...unconfirmable.values()].sort((a, b) => b.count - a.count),
    tokens: tokens.map((t) => ({ ...t, name: nameOf.get(t.locationId) ?? t.locationId })),
  });
}
