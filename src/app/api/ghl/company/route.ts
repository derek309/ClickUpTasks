import { NextRequest, NextResponse } from "next/server";
import { tokenForLocation } from "@/lib/ghlTokens";
import { requireUser } from "@/lib/serverAuth";
import { isGhlContactVisible } from "@/lib/extensionApi";

// Look up a single contact's business/company name from GoHighLevel.
// `contactId` here is a GHL contact id (the caller passes contact.ghlContactId),
// not a local contacts.id — same value ../task and ../import-tasks call
// `ghlContactId`.
export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ company: "" }, { status: 401 });
  const { locationId, contactId } = await req.json().catch(() => ({}));
  if (!locationId || !contactId) return NextResponse.json({ company: "" });
  // Caller-supplied location + contact, so requireUser alone let any signed-in
  // VA read a company name off any sub-account's contact. Same gate as the
  // other /api/ghl proxies; admins pass through unrestricted. The empty-string
  // response shape is kept so the (optional) company lookup degrades quietly.
  if (!(await isGhlContactVisible(caller, String(contactId))))
    return NextResponse.json({ company: "" }, { status: 403 });
  const token = await tokenForLocation(locationId);
  if (!token) return NextResponse.json({ company: "" });

  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
  });
  if (!res.ok) return NextResponse.json({ company: "" });
  const j = await res.json();
  const company = j.contact?.companyName ?? j.contact?.company ?? "";
  return NextResponse.json({ company });
}
