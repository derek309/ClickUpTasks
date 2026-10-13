import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess } from "@/lib/taskDocumentServer";
import { tidyLongTitle } from "@/lib/tidyTitle";

// POST: a task named with the whole request gets a short name, and the request
// becomes step 1's directions (Derek, 2026-10-13). The app calls it after
// saving a long name (db.ts); it does nothing to a name that is not long.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  return NextResponse.json(await tidyLongTitle(id));
}
