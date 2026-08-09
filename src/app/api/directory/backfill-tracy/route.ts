import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { resolveOrPromoteTrackedClient, upsertConversationTask } from "@/lib/ghlConversationTask";

// TEMPORARY — one-time: 3 real, matched, never-promoted Tracy prospects that
// clicked their invite but got no task, same gap found and fixed in
// Lincoln. Deleted after this runs.
const ROWS: { ghlContactId: string; contactId: string; name: string }[] = [
  { ghlContactId: "649gFibe59GG3Yq2akYu", contactId: "ct_ghl_649gFibe59GG3Yq2akYu", name: "Fiesta Auto Insurance & Tax Service" },
  { ghlContactId: "TYFYdEUMmJRiM1egPXpN", contactId: "ct_ghl_TYFYdEUMmJRiM1egPXpN", name: "Miller's Family Dentistry" },
  { ghlContactId: "g0GBGrzfarl43OordwOe", contactId: "ct_ghl_g0GBGrzfarl43OordwOe", name: "Milk & Sugar" },
];

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (req.headers.get("x-backfill-secret") !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results: { name: string; clientId: string; taskId: string | null }[] = [];
  for (const r of ROWS) {
    await supabaseAdmin.from("contacts").update({ city: "Tracy", state: "CA" }).eq("id", r.contactId);
    const clientId = await resolveOrPromoteTrackedClient({ id: r.contactId, name: r.name, client_id: "c_directory" });
    const taskId = await upsertConversationTask(
      { id: r.contactId, name: r.name, client_id: clientId },
      r.ghlContactId,
      { title: "Clicked the invite email — call or visit to close" },
    );
    results.push({ name: r.name, clientId, taskId });
  }
  return NextResponse.json({ ok: true, results });
}
