import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireApiToken } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";
import { locationFromSaasUrl } from "@/lib/saasUrl";

// A client's own GoHighLevel sub account and its key, for the Brain Box
// plugin's Setup, "Connect GoHighLevel" (2026-10-10). The key is full access
// to that sub account, so:
// - admins' tokens only (a teammate's is Derek's call, not made yet);
// - the sub account is the one in the client's SaaS link on their contact,
//   NOT clients.ghl_location_id: for a client who is a contact in the
//   agency, that is the agency's own location, and its key would be the
//   agency's;
// - never a shared sub account (Agency, Directory: the client rows whose id
//   doesn't start "cl_"), whatever the SaaS link says;
// - only a key an admin set for this client (client_ghl_keys), never the
//   team's own keys (ghl_tokens) or the shared GHL_TOKEN.
// No sub account, or no key stored for it: 404, which the plugin shows as
// "not yet". Never cached.
const noStore = { "Cache-Control": "no-store" };
const notYet = (error: string) => NextResponse.json({ error }, { status: 404, headers: noStore });

export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Service role key not configured." }, { status: 501 });
  const caller = await requireApiToken(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (caller.role !== "admin") return NextResponse.json({ error: "Only an admin's token can fetch a GoHighLevel key." }, { status: 403, headers: noStore });

  const clientId = (req.nextUrl.searchParams.get("client_id") ?? "").trim();
  if (!clientId) return NextResponse.json({ error: "client_id is required." }, { status: 400 });
  if (!clientId.startsWith("cl_")) return notYet("That is a shared sub account, not a client's own.");
  if (!(await isClientVisible(caller, clientId))) return NextResponse.json({ error: "Unknown or inaccessible client." }, { status: 403 });

  const { data: client } = await supabaseAdmin.from("clients").select("id, name, linked_contact_id").eq("id", clientId).is("deleted_at", null).maybeSingle();
  if (!client) return notYet("Unknown client.");
  const contactId = (client.linked_contact_id as string | null) || clientId.slice(3);
  const { data: contact } = await supabaseAdmin.from("contacts").select("saas_url").eq("id", contactId).maybeSingle();
  const locationId = locationFromSaasUrl(contact?.saas_url as string | null);
  if (!locationId) return notYet(`No SaaS sub account on ${client.name}'s contact yet.`);

  const { data: shared } = await supabaseAdmin.from("clients").select("id").not("id", "like", "cl_%").eq("ghl_location_id", locationId).limit(1);
  if (shared?.length) return notYet("That SaaS link points at a shared sub account.");

  // Only from client_ghl_keys (supabase/client-ghl-keys.sql), set by an
  // admin for this client and this sub account; never ghl_tokens, whose
  // keys are the team's own.
  const { data: key } = await supabaseAdmin.from("client_ghl_keys").select("location_id, token").eq("client_id", clientId).maybeSingle();
  if (!key || key.location_id !== locationId) return notYet(`No GoHighLevel key stored for ${client.name}'s sub account yet.`);
  return NextResponse.json({ location_id: locationId, token: key.token }, { headers: noStore });
}
