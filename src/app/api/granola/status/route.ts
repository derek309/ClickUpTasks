import { NextResponse } from "next/server";
import { granolaConfigured } from "@/lib/granolaClient";

export async function GET() {
  return NextResponse.json({ apiKeyConfigured: granolaConfigured, webhookConfigured: !!process.env.GRANOLA_WEBHOOK_SECRET });
}
