import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { getStages, getOppsByContact } from "@/lib/ghlOpportunities";

// The GHL Prospects pipeline for the territory view: the ordered funnel stages
// plus a contactId → current-stage map for every opportunity in it. Fetched
// once when a city opens, so each business row can show its stage locally
// (matched by its GHL contact id) instead of one API call per business.
// requireUser-gated; returns empty (not 501) when GHL isn't reachable so the
// rest of the territory view still works.

export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [stages, byContact] = await Promise.all([getStages(), getOppsByContact()]);
  return NextResponse.json({ stages, byContact });
}
