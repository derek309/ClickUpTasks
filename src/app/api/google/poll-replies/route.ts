import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { contactsByEmail } from "@/lib/contactsByEmail";
import { googleConfigured, readInboundGmail, readSentGmail, type SentEmail } from "@/lib/googleMail";
import { ingestInboundMessage, ingestOutboundMessage, ingestStrangerEmail, strangerThreadsIn } from "@/lib/inboundIngest";
import { tasksForMentionThreads, commentFromMentionReply } from "@/lib/mentionReply";
import { isBlocked } from "@/lib/inbox";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pull client email replies that came back through Gmail directly (bypassing
// GHL, because the app now sends "from" the teammate via Gmail) and ingest
// them so they still land in the app — logged on the client, bumping the
// Conversation task, ringing the bell. For each @clickuplocal.com teammate we
// read their recent inbox, match each sender to a known contact by email, and
// ingest anything new (deduped by Gmail message id).
//
// Trigger: a Vercel cron every 15 minutes, or an admin session (the app's
// "Sync email" action), see cronAuth.ts. It ran once a day until 2026-09-15,
// which meant a client's emailed reply could sit unseen for most of a day
// while the board still showed the task as waiting on them. Requires the DWD service account to also be authorized for
// the gmail.readonly scope in the Workspace Admin console.

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return run(req, 2);
}
// An admin may POST { days } (up to 30) once, to fill the Inbox with recent
// mail when it first goes live; the timer always reads two days.
export async function POST(req: NextRequest) {
  const body = await req.clone().json().catch(() => ({} as any));
  const days = typeof body?.days === "number" && body.days > 0 ? Math.min(Math.floor(body.days), 30) : 2;
  return run(req, days);
}

async function run(req: NextRequest, days: number) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!googleConfigured) return NextResponse.json({ error: "Google Workspace is not configured." }, { status: 501 });

  // Which mailboxes to read — the team's own @clickuplocal.com accounts.
  const { data: profiles } = await supabaseAdmin.from("profiles").select("email, member_id").ilike("email", "%@clickuplocal.com");
  const mailboxes = Array.from(new Set((profiles ?? []).map((p: any) => (p.email ?? "").toLowerCase()).filter(Boolean)));
  // Sent-folder pass (below) needs each mailbox's roster id to stamp as
  // created_by — the inbound pass has no equivalent need (created_by is
  // always null for a client's own inbound message).
  const memberIdByMailbox = new Map<string, string>();
  for (const p of profiles ?? []) {
    const email = (p.email ?? "").toLowerCase();
    if (email && p.member_id) memberIdByMailbox.set(email, p.member_id as string);
  }

  // Sender-email → contact map. A client email in a teammate's inbox is only
  // ingested when its From address matches a known contact.
  const byEmail = await contactsByEmail<any>("id, name, client_id, email, ghl_contact_id");

  // Admins triage unknown senders. Deterministic notification ids
  // (n_um_<gmailId>_<recipient>) make the every-10-min re-poll idempotent —
  // an unmatched email is surfaced in the Inbox exactly once, not each run.
  // category:primary keeps Gmail's own Promotions/Social/Updates tabs (where
  // newsletters + notifications live) out of what we scan.
  const query = `in:inbox category:primary newer_than:${days}d -from:me`;
  const sentQuery = `in:sent newer_than:${days}d`;
  // A catch-up reads more than one poll's worth.
  const max = days > 2 ? 200 : 25;
  let ingested = 0, scanned = 0, matched = 0, unmatched = 0, skippedAuto = 0, mentionReplies = 0;
  let sentScanned = 0, sentMatched = 0, sentIngested = 0, strangers = 0, strangerReplies = 0;
  const errors: string[] = [];

  // Each teammate's Block sender list: their blocked strangers are not kept.
  const { data: blockRows } = await supabaseAdmin.from("inbox_blocks").select("member_id, address");
  const blocksBy = new Map<string, string[]>();
  for (const r of blockRows ?? []) blocksBy.set(r.member_id as string, [...(blocksBy.get(r.member_id as string) ?? []), r.address as string]);

  for (const mailbox of mailboxes) {
    const memberId = memberIdByMailbox.get(mailbox) ?? null;
    let emails;
    try {
      emails = await readInboundGmail(mailbox, query, max);
    } catch (e) {
      errors.push(`${mailbox}: ${e instanceof Error ? e.message : "read failed"}`);
      continue;
    }
    const mentionThreads = await tasksForMentionThreads(emails.map((em) => em.threadId));
    for (const em of emails) {
      scanned++;
      // A teammate answering a mention email, checked before anything else:
      // they are not a contact, so the lookup below would read their reply as
      // mail from a stranger and park it in the Inbox rather than putting it
      // on the task. Gmail gives a reply the same thread id as the mention we
      // sent, which is the whole of the matching (see lib/mentionReply).
      const mentionTaskId = em.threadId ? mentionThreads.get(em.threadId) : undefined;
      if (mentionTaskId) {
        try {
          const added = await commentFromMentionReply({
            taskId: mentionTaskId, fromEmail: em.fromEmail, body: em.body,
            gmailMessageId: em.gmailId, at: em.internalDate,
          });
          if (added) mentionReplies++;
        } catch (e) {
          errors.push(`mention ${em.gmailId}: ${e instanceof Error ? e.message : "failed"}`);
        }
        continue;
      }
      const contact = byEmail.get(em.fromEmail);
      if (contact) {
        // In the system → log it on the client's Journal (+ bump task, ring bell).
        matched++;
        try {
          const did = await ingestInboundMessage({
            contact: { id: contact.id, name: contact.name, client_id: contact.client_id },
            ghlContactId: contact.ghl_contact_id ?? null,
            channel: "email", subject: em.subject, body: em.body,
            gmailMessageId: em.gmailId, gmailThreadId: em.threadId, rfc822: em.rfc822, at: em.internalDate,
            mailboxMemberId: memberId, fromName: em.fromName || null, fromAddress: em.fromEmail, files: em.attachments,
          });
          if (did) ingested++;
        } catch (e) {
          errors.push(`ingest ${em.gmailId}: ${e instanceof Error ? e.message : "failed"}`);
        }
      } else {
        // Not a contact yet → into this teammate's Inbox as a stranger, so it
        // is not lost; from there they can answer it, add the person or link
        // it to a task. Automated mail (newsletters, no-reply, notifications)
        // stays in Gmail: people, not robots (Derek, 2026-10-01).
        if (em.auto) { skippedAuto++; continue; }
        unmatched++;
        if (!memberId || isBlocked(em.fromEmail, blocksBy.get(memberId) ?? [])) continue;
        try {
          if (await ingestStrangerEmail({
            mailboxMemberId: memberId, direction: "inbound", peerName: em.fromName || null, peerAddress: em.fromEmail,
            subject: em.subject, body: em.body, gmailMessageId: em.gmailId, gmailThreadId: em.threadId, rfc822: em.rfc822, at: em.internalDate,
            files: em.attachments,
          })) strangers++;
        } catch (e) {
          errors.push(`stranger ${em.gmailId}: ${e instanceof Error ? e.message : "failed"}`);
        }
      }
    }

    // Sent-folder pass — a reply the teammate sent directly from their own
    // Gmail (not the in-app "send as" composer), which the inbound pass above
    // can never see (it explicitly excludes -from:me). Unmatched sent mail is
    // skipped silently: unlike an unmatched inbound email, it's not a lead to
    // triage — just the teammate emailing someone outside the CRM.
    const createdBy = memberIdByMailbox.get(mailbox);
    if (createdBy) {
      let sent: SentEmail[];
      try {
        sent = await readSentGmail(mailbox, sentQuery, max);
      } catch (e) {
        errors.push(`${mailbox} (sent): ${e instanceof Error ? e.message : "read failed"}`);
        sent = [];
      }
      const strangerThreads = await strangerThreadsIn(createdBy, sent.map((em) => em.threadId));
      for (const em of sent) {
        sentScanned++;
        const contact = em.toEmails.map((e) => byEmail.get(e)).find(Boolean);
        if (!contact) {
          // The teammate answering a stranger's email from Gmail: it joins
          // that conversation in their Inbox. Mail to anyone else is theirs.
          if (!em.threadId || !strangerThreads.has(em.threadId)) continue;
          try {
            if (await ingestStrangerEmail({
              mailboxMemberId: createdBy, direction: "outbound", peerAddress: em.toEmails[0] ?? "",
              subject: em.subject, body: em.body, gmailMessageId: em.gmailId, gmailThreadId: em.threadId, rfc822: em.rfc822, at: em.internalDate,
              files: em.attachments,
            })) strangerReplies++;
          } catch (e) {
            errors.push(`stranger sent ${em.gmailId}: ${e instanceof Error ? e.message : "failed"}`);
          }
          continue;
        }
        sentMatched++;
        try {
          const did = await ingestOutboundMessage({
            contact: { id: contact.id, name: contact.name, client_id: contact.client_id },
            channel: "email", subject: em.subject, body: em.body,
            gmailMessageId: em.gmailId, gmailThreadId: em.threadId, rfc822: em.rfc822, createdBy, at: em.internalDate,
            toAddress: em.toEmails[0] ?? null, files: em.attachments,
          });
          if (did) sentIngested++;
        } catch (e) {
          errors.push(`ingest sent ${em.gmailId}: ${e instanceof Error ? e.message : "failed"}`);
        }
      }
    }
  }

  return NextResponse.json({
    ok: true, mailboxes: mailboxes.length, scanned, matched, ingested, unmatched, strangers, skippedAuto, mentionReplies,
    sentScanned, sentMatched, sentIngested, strangerReplies,
    ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
  });
}
