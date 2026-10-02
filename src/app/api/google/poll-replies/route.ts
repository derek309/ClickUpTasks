import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { contactsByEmail } from "@/lib/contactsByEmail";
import { googleConfigured, readInboundGmail, readSentGmail, type SentEmail } from "@/lib/googleMail";
import { ingestInboundMessage, ingestOutboundMessage, ingestStrangerEmail, ingestTeammateCopy, strangerThreadsIn } from "@/lib/inboundIngest";
import { tasksForMentionThreads, commentFromMentionReply } from "@/lib/mentionReply";
import { isBlocked, inboundGmailQuery, UPDATES_FROM } from "@/lib/inbox";

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
  return run(req, 2, null, false);
}
// An admin may POST { days } (up to 30) once, to fill the Inbox with recent
// mail when it first goes live; the timer always reads two days.
export async function POST(req: NextRequest) {
  const body = await req.clone().json().catch(() => ({} as any));
  const days = typeof body?.days === "number" && body.days > 0 ? Math.min(Math.floor(body.days), 30) : 2;
  // { member }: only that teammate's mailbox, for the catch-up after they add
  // someone to Always let in.
  const only = typeof body?.member === "string" && body.member ? body.member as string : null;
  // all: the ↻ button, one person's whole mailbox now; otherwise the
  // Always to Inbox catch-up, just the senders let in.
  return run(req, days, only, !!body?.all);
}

async function run(req: NextRequest, days: number, only: string | null, all = false) {
  if (!adminConfigured) return NextResponse.json({ error: "Server not configured." }, { status: 501 });
  if (!(await authorizeCron(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!googleConfigured) return NextResponse.json({ error: "Google Workspace is not configured." }, { status: 501 });

  // Which mailboxes to read — the team's own @clickuplocal.com accounts.
  const { data: profiles } = await supabaseAdmin.from("profiles").select("email, member_id").ilike("email", "%@clickuplocal.com");
  const mailboxes = Array.from(new Set((profiles ?? []).filter((p: any) => !only || p.member_id === only).map((p: any) => (p.email ?? "").toLowerCase()).filter(Boolean)));
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
  // Teammates are never the client in a conversation, even though GoHighLevel
  // keeps them as contacts (Derek, 2026-10-02).
  const teamEmails = new Set(memberIdByMailbox.keys());
  for (const e of teamEmails) byEmail.delete(e);
  let teammateCopies = 0;

  // Admins triage unknown senders. Deterministic notification ids
  // (n_um_<gmailId>_<recipient>) make the every-10-min re-poll idempotent —
  // an unmatched email is surfaced in the Inbox exactly once, not each run.
  // category:primary keeps Gmail's own Promotions/Social/Updates tabs (where
  // newsletters + notifications live) out of what we scan.
  // Each teammate's Always let in list (Inbox Settings): their mail comes in
  // from any Gmail tab and even when it looks automated.
  const { data: prefRows } = await supabaseAdmin.from("inbox_prefs").select("member_id, prefs");
  const allowsBy = new Map<string, string[]>();
  for (const r of prefRows ?? []) {
    const list = (r.prefs as any)?.allowSenders;
    if (Array.isArray(list)) allowsBy.set(r.member_id as string, list.filter((x: unknown): x is string => typeof x === "string"));
  }
  const sentQuery = `in:sent newer_than:${days}d`;
  // A catch-up reads more than one poll's worth.
  const max = days > 2 ? 200 : 50;
  let ingested = 0, scanned = 0, matched = 0, unmatched = 0, skippedAuto = 0, mentionReplies = 0;
  let sentScanned = 0, sentMatched = 0, sentIngested = 0, strangers = 0, strangerReplies = 0, readInGmail = 0;
  const errors: string[] = [];

  // Each teammate's Block sender list: their blocked strangers are not kept.
  const { data: blockRows } = await supabaseAdmin.from("inbox_blocks").select("member_id, address");
  const blocksBy = new Map<string, string[]>();
  for (const r of blockRows ?? []) blocksBy.set(r.member_id as string, [...(blocksBy.get(r.member_id as string) ?? []), r.address as string]);

  for (const mailbox of mailboxes) {
    const memberId = memberIdByMailbox.get(mailbox) ?? null;
    let emails;
    try {
      emails = await readInboundGmail(mailbox, inboundGmailQuery(days, memberId ? allowsBy.get(memberId) ?? [] : [], !!only && !all), max);
    } catch (e) {
      errors.push(`${mailbox}: ${e instanceof Error ? e.message : "read failed"}`);
      continue;
    }
    const mentionThreads = await tasksForMentionThreads(emails.map((em) => em.threadId));
    // Read in Gmail: read in this teammate's Inbox too (Derek, 2026-10-01).
    if (memberId) {
      try { readInGmail += await markReadFromGmail(memberId, emails); }
      catch (e) { errors.push(`${mailbox} read state: ${e instanceof Error ? e.message : "failed"}`); }
    }
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
      // A teammate's own email (Justin answering with Derek on CC): their
      // reply, to whoever outside the team it went to.
      if (teamEmails.has(em.fromEmail)) {
        const outside = (em.others ?? []).filter((a) => !teamEmails.has(a));
        if (memberId && outside.length) {
          try {
            if (await ingestTeammateCopy({
              mailboxMemberId: memberId, senderMemberId: memberIdByMailbox.get(em.fromEmail) ?? null, peerAddress: outside[0],
              subject: em.subject, body: em.body, gmailMessageId: em.gmailId, gmailThreadId: em.threadId, rfc822: em.rfc822, at: em.internalDate,
              files: em.attachments, others: em.others,
            })) teammateCopies++;
          } catch (e) {
            errors.push(`teammate ${em.gmailId}: ${e instanceof Error ? e.message : "failed"}`);
          }
          continue;
        }
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
            mailboxMemberId: memberId, fromName: em.fromName || null, fromAddress: em.fromEmail, files: em.attachments, others: em.others,
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
        // Everything comes in now; automated mail, or what Gmail files
        // outside Primary, goes to the Updates folder (bulk). Updates began
        // today, so older mail like that is not pulled in.
        const bulk = em.auto || (!!em.tab && em.tab !== "primary");
        const allowed = !!memberId && isBlocked(em.fromEmail, allowsBy.get(memberId) ?? []);
        if (bulk && !allowed && new Date(em.internalDate).getTime() < UPDATES_FROM) { skippedAuto++; continue; }
        unmatched++;
        if (!memberId || isBlocked(em.fromEmail, blocksBy.get(memberId) ?? [])) continue;
        try {
          if (await ingestStrangerEmail({
            mailboxMemberId: memberId, direction: "inbound", peerName: em.fromName || null, peerAddress: em.fromEmail,
            subject: em.subject, body: em.body, gmailMessageId: em.gmailId, gmailThreadId: em.threadId, rfc822: em.rfc822, at: em.internalDate,
            files: em.attachments, others: em.others, bulk,
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
    // The let-in catch-up reads only inbound mail from the people let in.
    if (createdBy && (!only || all)) {
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
              mailboxMemberId: createdBy, direction: "outbound", peerAddress: em.toEmails.find((a) => !teamEmails.has(a)) ?? em.toEmails[0] ?? "",
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
            toAddress: em.toEmails.find((a) => !teamEmails.has(a)) ?? em.toEmails[0] ?? null, files: em.attachments,
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
    sentScanned, sentMatched, sentIngested, strangerReplies, readInGmail, teammateCopies,
    ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
  });
}

// A conversation whose emails here are all read in Gmail is read in the
// teammate's Inbox as of the newest of them. Only moves read_at forward, and
// only touches read_at, so snooze, archive and trash are left as they are.
async function markReadFromGmail(memberId: string, emails: { threadId: string; internalDate: string; unread?: boolean }[]): Promise<number> {
  const byThread = new Map<string, { newest: number; anyUnread: boolean }>();
  for (const em of emails) {
    if (!em.threadId || em.unread === undefined) continue;
    const t = byThread.get(em.threadId) ?? { newest: 0, anyUnread: false };
    t.newest = Math.max(t.newest, new Date(em.internalDate).getTime());
    t.anyUnread = t.anyUnread || em.unread;
    byThread.set(em.threadId, t);
  }
  const read = [...byThread].filter(([, t]) => !t.anyUnread && t.newest > 0);
  if (!read.length) return 0;
  const keys = read.map(([id]) => `gm:${id}`);
  const { data: have } = await supabaseAdmin.from("inbox_state").select("thread_key, read_at").eq("member_id", memberId).in("thread_key", keys);
  const readAt = new Map((have ?? []).map((r: any) => [r.thread_key as string, r.read_at ? new Date(r.read_at).getTime() : 0]));
  const rows = read
    .filter(([id, t]) => (readAt.get(`gm:${id}`) ?? 0) < t.newest)
    .map(([id, t]) => ({ member_id: memberId, thread_key: `gm:${id}`, read_at: new Date(t.newest).toISOString() }));
  if (!rows.length) return 0;
  const { error } = await supabaseAdmin.from("inbox_state").upsert(rows, { onConflict: "member_id,thread_key" });
  if (error) throw new Error(error.message);
  return rows.length;
}
