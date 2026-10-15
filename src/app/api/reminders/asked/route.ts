import { NextRequest, NextResponse } from "next/server";
import { canCallerMessageClient, requireUser } from "@/lib/serverAuth";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { askedLog } from "@/lib/clientRequestsServer";

// What went to a client about each of their steps (Derek and Justin,
// 2026-10-15): the step page's Asked list and "asked N times since" in What
// we need from <client>. GET ?client=<id>&steps=<id>,<id>
// → { asked: { [stepId]: [{ at, stage, status }] } }.
// Anyone who may message the client.

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = req.nextUrl.searchParams.get("client") ?? "";
  const steps = (req.nextUrl.searchParams.get("steps") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  if (!clientId || !steps.length) return NextResponse.json({ asked: {} });
  if (await canCallerMessageClient(caller, clientId)) return NextResponse.json({ asked: {} });
  return NextResponse.json({ asked: await askedLog(clientId, steps) });
}
