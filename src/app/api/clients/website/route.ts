import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/serverAuth";
import { checkSite, siteBase } from "@/lib/clientWebsite";

// An admin sets a client's WordPress site: the address, a username and an
// Application Password, for sending task pictures to its Media Library
// (Derek, 2026-10-12). Checked by signing in before it's kept; the password
// is never sent back to the browser. supabase/client-websites.sql.
const noStore = { "Cache-Control": "no-store" };

/** Whether the client has a site, and which. Never the password. */
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = (req.nextUrl.searchParams.get("client_id") ?? "").trim();
  const { data } = await supabaseAdmin.from("client_websites").select("site_url, wp_user, updated_at").eq("client_id", clientId).maybeSingle();
  return NextResponse.json(data ? { connected: true, url: data.site_url, user: data.wp_user, updatedAt: data.updated_at } : { connected: false }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { client_id?: string; url?: string; user?: string; password?: string };
  const url = siteBase(String(b.url ?? ""));
  const user = String(b.user ?? "").trim();
  const password = String(b.password ?? "").trim();
  if (!b.client_id || !url || !user || !password) return NextResponse.json({ error: "The site's address (https), a username and an Application Password are all needed." }, { status: 400 });
  const check = await checkSite({ url, user, password });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  const { error } = await supabaseAdmin.from("client_websites").upsert({ client_id: b.client_id, site_url: url, wp_user: user, app_password: password, created_by: admin.memberId, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: /client_websites/.test(error.message) ? "Run supabase/client-websites.sql first." : error.message }, { status: 400 });
  return NextResponse.json({ ok: true, url, user, as: check.name }, { headers: noStore });
}

export async function DELETE(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clientId = (req.nextUrl.searchParams.get("client_id") ?? "").trim();
  await supabaseAdmin.from("client_websites").delete().eq("client_id", clientId);
  return NextResponse.json({ ok: true }, { headers: noStore });
}
