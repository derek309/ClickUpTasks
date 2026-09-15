// SERVER-ONLY: who may run a cron route (send-scheduled, poll-replies,
// sync-appointments, doc-reminders, purge-trash). Vercel's scheduler sends
// Authorization: Bearer <CRON_SECRET>; an admin session covers the app's own
// Sync buttons.
//
// The GoHighLevel webhook secret used to work here too, as ?secret=. It sits
// in plain text in every sub-account's workflow URL, so anyone who could open
// a workflow could fire scheduled sends. It now only opens the webhook.
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { requireUser } from "./serverAuth";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch rather than returning false.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function authorizeCron(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && sameSecret(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return true;
  const caller = await requireUser(req);
  return !!caller && caller.role === "admin";
}
