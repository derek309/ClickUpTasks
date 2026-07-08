import { NextRequest, NextResponse } from "next/server";
import { tokenForLocation } from "@/lib/ghlTokens";

// Look up a single contact's business/company name from GoHighLevel.
export async function POST(req: NextRequest) {
  const { locationId, contactId } = await req.json().catch(() => ({}));
  if (!locationId || !contactId) return NextResponse.json({ company: "" });
  const token = tokenForLocation(locationId);
  if (!token) return NextResponse.json({ company: "" });

  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" },
  });
  if (!res.ok) return NextResponse.json({ company: "" });
  const j = await res.json();
  const company = j.contact?.companyName ?? j.contact?.company ?? "";
  return NextResponse.json({ company });
}
