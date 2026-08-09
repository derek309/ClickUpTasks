import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { upsertConversationTask } from "@/lib/ghlConversationTask";

// TEMPORARY — one-time: 10 real, already-promoted Lincoln prospects (real
// clicks, real listing matches, real tracked clients) that never got a
// Conversation task, most likely lost when the 15 newsletter/agency false
// positives were being investigated. Deleted after this runs.
const ROWS: { ghlContactId: string; contactId: string; clientId: string; name: string }[] = [
  { ghlContactId: "1bmelXNcbl8TU45UThi6", contactId: "ct_ghl_1bmelXNcbl8TU45UThi6", clientId: "cl_ct_ghl_1bmelXNcbl8TU45UThi6", name: "Lincoln Spine And Sport" },
  { ghlContactId: "u0cVsi85XVy00GaiG5G4", contactId: "ct_ghl_u0cVsi85XVy00GaiG5G4", clientId: "cl_ct_ghl_u0cVsi85XVy00GaiG5G4", name: "The Rockstar Music Academy" },
  { ghlContactId: "HSsHzZ6IIHptEMzLAj3B", contactId: "ct_ghl_HSsHzZ6IIHptEMzLAj3B", clientId: "cl_ct_ghl_HSsHzZ6IIHptEMzLAj3B", name: "A Plus Dental Care - Lincoln" },
  { ghlContactId: "1eMX3yPbgAXGJQBWVDga", contactId: "ct_ghl_1eMX3yPbgAXGJQBWVDga", clientId: "cl_ct_ghl_1eMX3yPbgAXGJQBWVDga", name: "Caring Tree Children's Dentistry" },
  { ghlContactId: "uvor9RD6OYdtPy0Ia0Kk", contactId: "ct_ghl_uvor9RD6OYdtPy0Ia0Kk", clientId: "cl_ct_ghl_uvor9RD6OYdtPy0Ia0Kk", name: "Diamond Star Painting" },
  { ghlContactId: "nVOIzBfFkhlR46lkP2g6", contactId: "ct_ghl_nVOIzBfFkhlR46lkP2g6", clientId: "cl_ct_ghl_nVOIzBfFkhlR46lkP2g6", name: "Dr. Rubina Khorana" },
  { ghlContactId: "thMygQ94EMQG4v1fcoMr", contactId: "ct_ghl_thMygQ94EMQG4v1fcoMr", clientId: "cl_ct_ghl_thMygQ94EMQG4v1fcoMr", name: "Sun City Lincoln Hills" },
  { ghlContactId: "8ncKBtTXucMb8FErKJxn", contactId: "ct_ghl_8ncKBtTXucMb8FErKJxn", clientId: "cl_ct_ghl_8ncKBtTXucMb8FErKJxn", name: "5 Star Plumbing" },
  { ghlContactId: "mhjlY54w0ZCCC6XpEvWY", contactId: "ct_ghl_mhjlY54w0ZCCC6XpEvWY", clientId: "cl_ct_ghl_mhjlY54w0ZCCC6XpEvWY", name: "Turkey Creek Golf Club" },
  { ghlContactId: "e8O8fA4RCfr7GdQ2lkRP", contactId: "ct_ghl_e8O8fA4RCfr7GdQ2lkRP", clientId: "cl_ct_ghl_e8O8fA4RCfr7GdQ2lkRP", name: "Cerámica - Wellness Suites and Residences" },
];

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (req.headers.get("x-backfill-secret") !== process.env.BACKFILL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results: { name: string; taskId: string | null }[] = [];
  for (const r of ROWS) {
    const taskId = await upsertConversationTask(
      { id: r.contactId, name: r.name, client_id: r.clientId },
      r.ghlContactId,
      { title: "Clicked the invite email — call or visit to close" },
    );
    results.push({ name: r.name, taskId });
  }
  return NextResponse.json({ ok: true, results });
}
