import { NextResponse } from "next/server";
import { configuredLocations } from "@/lib/ghlTokens";

// Reports which GoHighLevel sub-accounts have a token configured on the server.
// Tokens themselves are never returned to the browser.
export async function GET() {
  const locations = configuredLocations();
  return NextResponse.json({ configured: locations.length > 0 || Boolean(process.env.GHL_TOKEN), locations });
}
