import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { setStage, getStages, getOppsByContact, opportunitiesConfigured } from "@/lib/ghlOpportunities";

// Advance a business through the GHL Prospects pipeline from the territory
// view. Updates the business's opportunity stage (or creates the opportunity
// in that stage if it isn't in the pipeline yet). GHL stays the source of
// truth for sales tracking. requireUser-gated.
//
// GET returns what the territory needs to render the Stage column: the
// pipeline's ordered stages plus every business's current stage keyed by GHL
// contact id. The stage list is read live from GHL rather than hardcoded, so
// the dropdown IS the gameplan's locked 9-stage funnel (G2 SOP) by
// definition — renaming or reordering a stage in GHL flows through with no
// code change, and the app can never drift from the SOP.

export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Degrade cleanly (like /api/directory/listings) when the pipeline env
  // isn't configured — the territory just hides the Stage control.
  if (!opportunitiesConfigured()) {
    return NextResponse.json({ error: "Prospects pipeline not configured", stages: [], byContact: {} }, { status: 501 });
  }
  // Both are independent GHL reads — run them together so a whole city's
  // stage column resolves in one round-trip's worth of latency.
  const [stages, byContact] = await Promise.all([getStages(), getOppsByContact()]);
  return NextResponse.json({ stages, byContact });
}

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const contactId = String(body?.contactId ?? "").trim();
  const stageId = String(body?.stageId ?? "").trim();
  const name = String(body?.name ?? "Prospect");
  const opportunityId = body?.opportunityId ? String(body.opportunityId) : undefined;
  if (!contactId || !stageId) return NextResponse.json({ error: "contactId and stageId are required" }, { status: 400 });

  const result = await setStage({ contactId, stageId, name, opportunityId });
  if (!result) return NextResponse.json({ error: "Could not update the GHL opportunity" }, { status: 502 });
  return NextResponse.json({ ok: true, ...result });
}
