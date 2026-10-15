import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { listTextAccounts } from "@/lib/ghlNumbers";

// The GoHighLevel numbers we can text from, grouped by sub account (Derek,
// 2026-10-15: "show all of our GHL numbers that we can text from and which
// account they're on"). The team only: an admin, or someone on the roster.
// Numbers and account names only, never a token. ?fresh=1 reads GoHighLevel
// again instead of the hour's list.
export async function GET(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller || (caller.role !== "admin" && !caller.memberId)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accounts = await listTextAccounts({ fresh: req.nextUrl.searchParams.get("fresh") === "1" });
  return NextResponse.json({ accounts, numbers: accounts.flatMap((a) => a.numbers) });
}
