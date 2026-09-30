import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { rateLimit } from "@/lib/rateLimit";
import { readPublicJson } from "@/lib/taskDocumentServer";
import { BRIEF_TOKEN_PATTERN } from "@/lib/brief";
import { NO_STORE, briefNotFound, resolveBriefToken } from "@/lib/briefServer";

// Public, no login: the outside page reports it was on screen for a few seconds,
// so the team sees "Viewed 2h ago". The link's GET never counts (scanners).

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { token } = await params;
  if (!BRIEF_TOKEN_PATTERN.test(token)) return briefNotFound();
  const limited = await rateLimit(req, token, "brief_view");
  if (limited) return limited;
  const read = await readPublicJson(req);
  if (!read.ok) return read.res;
  const scope = await resolveBriefToken(token);
  if (!scope) return briefNotFound();
  await supabaseAdmin.from("task_briefs").update({ viewed_at: new Date().toISOString() }).eq("id", scope.briefId);
  return json({ ok: true });
}
