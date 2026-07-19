import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuth";
import { googleConfigured, readInboundGmail } from "@/lib/googleMail";
import { ingestInboundMessage } from "@/lib/inboundIngest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pull client email replies that came back through Gmail directly (bypassing
// GHL, because the app now sends "from" the teammate via Gmail) and ingest
// them so they still land in the app — logged on the client, bumping the
// Conversation task, ringing the bell. For each @clickuplocal.com teammate we
// read their recent inbox, match each sender to a known contact by email, and
// ingest anything new (deduped by Gmail message id).
//
// Trigger: a Vercel cron (Authorization: Bearer <CRON_SECRET>), a manual call
// with ?secret=<GHL_WEBHOOK_SECRET>, or an admin session (the app's "Sync
// email" action). Requires the DWD service account to also be authorized for
// the gmail.readonly scope in the Workspace Admin console.

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });

  // Authorize: Vercel cron header, a shared secret, or an admin session.
  const authHeader = req.headers.get("authorization") ?? "";
  const cronOk = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const secretOk = !!process.env.GHL_WEBHOOK_SECRET && req.nextUrl.searchParams.get("secret") === process.env.GHL_WEBHOOK_SECRET;
  if (!cronOk && !secretOk) {
    const caller = await requireUser(req);
    if (!caller || caller.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!googleConfigured) return NextResponse.json({ error: "Google Workspace is not configured." }, { status: 501 });

  // Which mailboxes to read — the team's own @clickuplocal.com accounts.
  const { data: profiles } = await supabaseAdmin.from("profiles").select("email").ilike("email", "%@clickuplocal.com");
  const mailboxes = Array.from(new Set((profiles ?? []).map((p: any) => (p.email ?? "").toLowerCase()).filter(Boolean)));

  // Sender-email → contact map. A client email in a teammate's inbox is only
  // ingested when its From address matches a known contact.
  const { data: contacts } = await supabaseAdmin.from("contacts").select("id, name, client_id, email, ghl_contact_id").not("email", "is", null);
  const byEmail = new Map<string, any>();
  for (const c of contacts ?? []) {
    const e = (c.email ?? "").trim().toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, c);
  }

  const query = "in:inbox newer_than:2d -from:me";
  let ingested = 0, scanned = 0, matched = 0;
  const errors: string[] = [];

  for (const mailbox of mailboxes) {
    let emails;
    try {
      emails = await readInboundGmail(mailbox, query);
    } catch (e) {
      errors.push(`${mailbox}: ${e instanceof Error ? e.message : "read failed"}`);
      continue;
    }
    for (const em of emails) {
      scanned++;
      const contact = byEmail.get(em.fromEmail);
      if (!contact) continue;
      matched++;
      try {
        const did = await ingestInboundMessage({
          contact: { id: contact.id, name: contact.name, client_id: contact.client_id },
          ghlContactId: contact.ghl_contact_id ?? null,
          channel: "email", subject: em.subject, body: em.body,
          gmailMessageId: em.gmailId, at: em.internalDate,
        });
        if (did) ingested++;
      } catch (e) {
        errors.push(`ingest ${em.gmailId}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
  }

  return NextResponse.json({ ok: true, mailboxes: mailboxes.length, scanned, matched, ingested, ...(errors.length ? { errors: errors.slice(0, 10) } : {}) });
}
