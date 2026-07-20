import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { setStage } from "@/lib/ghlOpportunities";

// Advance a business through the GHL Prospects pipeline from the territory
// view. Updates the business's opportunity stage (or creates the opportunity
// in that stage if it isn't in the pipeline yet). GHL stays the source of
// truth for sales tracking. requireUser-gated.

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
