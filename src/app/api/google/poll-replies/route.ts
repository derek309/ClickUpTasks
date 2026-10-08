import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { authorizeCron } from "@/lib/cronAuth";
import { contactsByEmail } from "@/lib/contactsByEmail";
import { type InboundEmail, googleConfigured, gmailThreadIds, readInboundGmail, readInboxThreadsLatest, readSentGmail, type SentEmail } from "@/lib/googleMail";
import { ingestInboundMessage, ingestOutboundMessage, ingestStrangerEmail, ingestTeammateCopy, strangerThreadsIn } from "@/lib/inboundIngest";
import { tasksForMentionThreads, commentFromMentionReply } from "@/lib/mentionReply";
import { isBlocked, inboundGmailQuery } from "@/lib/inbox";

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
  // quick: the Inbox's every-minute pull. New mail only; the mirror, Gmail's
  // read and archive state and the Sent folder are left to the 5 minute run,
  // and nothing more is read when nothing is new (Derek, 2026-10-07: the
  // database ran short of disk reads).
  return run(req, days, only, !!body?.all, !!body?.quick);
}

async function run(req: NextRequest, days: number, only: string | null, all = false, quick = false) {
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
  // Read once, and only when a run has an email to match: every contact is
  // 4,200 rows, and most runs find nothing new.
  // Teammates are never the client in a conversation, even though GoHighLevel
  // keeps them as contacts (Derek, 2026-10-02).
  const teamEmails = new Set(memberIdByMailbox.keys());
  let byEmailOnce: Promise<Map<string, any>> | null = null;
  const contactsFor = () => (byEmailOnce ??= contactsByEmail<any>("id, name, client_id, email, ghl_contact_id").then((m) => { for (const e of teamEmails) m.delete(e); return m; }));
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
  let ingested = 0, scanned = 0, matched = 0, unmatched = 0, mentionReplies = 0, mirrored = 0, reopened = 0, unreadInGmail = 0;
  let sentScanned = 0, sentMatched = 0, sentIngested = 0, strangers = 0, notices = 0, strangerReplies = 0, readInGmail = 0, archivedInGmail = 0, trashedInGmail = 0;
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
    // The mirror: every thread in their Gmail inbox is in their Inbox here,
    // however old (snoozed mail coming back included). Up to 25 a run, so a
    // first catch-up finishes over a few runs. Then Gmail's inbox and read
    // state are copied onto the app's (syncInboxState).
    if (quick && emails.length) {
      // Only what isn't stored yet.
      const { data: had } = await supabaseAdmin.from("messages").select("gmail_message_id").in("gmail_message_id", emails.map((em) => em.gmailId));
      const stored = new Set((had ?? []).map((r: any) => r.gmail_message_id as string));
      // Blocked senders and replies to a mention email are never stored as
      // a message, so they'd pass this every minute and cost a full contacts
      // read each time; the 5 minute run handles them (audit 2026-10-07).
      const blocked = memberId ? blocksBy.get(memberId) ?? [] : [];
      const mention = await tasksForMentionThreads(emails.map((em) => em.threadId));
      emails = emails.filter((em) => !stored.has(em.gmailId) && !isBlocked(em.fromEmail, blocked) && !(em.threadId && mention.has(em.threadId)));
    }
    if (quick && !emails.length) continue;
    if (memberId && !(only && !all) && !quick) {
      try {
        const inInbox = await gmailThreadIds(mailbox, "in:inbox newer_than:90d", 2);
        const seen = new Set(emails.map((em) => em.threadId));
        const ids = [...inInbox].filter((id) => !seen.has(id));
        const known = new Set<string>();
        for (let i = 0; i < ids.length; i += 200) {
          const { data } = await supabaseAdmin.from("messages").select("gmail_thread_id").eq("mailbox_member_id", memberId).in("gmail_thread_id", ids.slice(i, i + 200));
          for (const r of data ?? []) known.add(r.gmail_thread_id as string);
        }
        const missing = ids.filter((id) => !known.has(id)).slice(0, 25);
        if (missing.length) { const more = await readInboxThreadsLatest(mailbox, missing); emails.push(...more); mirrored += more.length; }
        const r = await syncInboxState(memberId, mailbox, inInbox);
        reopened += r.reopened; unreadInGmail += r.unread;
      } catch (e) {
        errors.push(`${mailbox} mirror: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    const mentionThreads = await tasksForMentionThreads(emails.map((em) => em.threadId));
    // Read in Gmail: read in this teammate's Inbox too (Derek, 2026-10-01).
    if (memberId) {
      try { readInGmail += await markReadFromGmail(memberId, emails); }
      catch (e) { errors.push(`${mailbox} read state: ${e instanceof Error ? e.message : "failed"}`); }
      // Archived or deleted in Gmail: Done or Trash in their Inbox too.
      if (!quick) try { const r = await clearFromGmail(memberId, mailbox); archivedInGmail += r.archived; trashedInGmail += r.trashed; }
      catch (e) { errors.push(`${mailbox} archive state: ${e instanceof Error ? e.message : "failed"}`); }
    }
    for (const em of emails) {
      scanned++;
      // The app's own notification ("Pamela Macias replied on ...") is about
      // a task: it goes in the Inbox on that task and its client, so it opens
      // the task in one click (Derek, 2026-10-07: "I don't know how we
      // connect it to a task"). Checked first: it is from a teammate to
      // themselves, which nothing below would place.
      const noticeTask = memberId && teamEmails.has(em.fromEmail) ? await notificationTask(em) : null;
      if (noticeTask) {
        try {
          if (await ingestStrangerEmail({
            mailboxMemberId: memberId!, direction: "inbound", peerName: "ClickUpTasks", peerAddress: em.fromEmail,
            subject: em.subject, body: em.body, gmailMessageId: em.gmailId, gmailThreadId: em.threadId, rfc822: em.rfc822, at: em.internalDate,
            bulk: !!em.tab && em.tab !== "primary", task: noticeTask,
          })) notices++;
        } catch (e) {
          errors.push(`notice ${em.gmailId}: ${e instanceof Error ? e.message : "failed"}`);
        }
        continue;
      }
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
      const contact = (await contactsFor()).get(em.fromEmail);
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
        // Inbox or Updates by Gmail's own tab only, nothing guessed (Derek,
        // 2026-10-07: "Inbox and Updates is fine, just two"; "stop trying to filter").
        const bulk = !!em.tab && em.tab !== "primary";
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
    if (createdBy && (!only || all) && !quick) {
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
        const byEmail = await contactsFor();
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
    ok: true, mailboxes: mailboxes.length, scanned, matched, ingested, unmatched, strangers, notices, mirrored, reopened, unreadInGmail, mentionReplies,
    sentScanned, sentMatched, sentIngested, strangerReplies, readInGmail, archivedInGmail, trashedInGmail, teammateCopies,
    ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
  });
}

// A conversation whose emails here are all read in Gmail is read in the
// teammate's Inbox as of the newest of them. Only moves read_at forward, and
// only touches read_at, so snooze, archive and trash are left as they are.
/** The task one of the app's notification emails is about: named in its
 *  header, or, for one sent before the header, the task its subject quotes
 *  ("Pamela Macias replied on "Tell us how many seats..."") on a notification. */
async function notificationTask(em: InboundEmail): Promise<{ id: string; clientId: string | null } | null> {
  let q = supabaseAdmin.from("tasks").select("id, client_id").is("deleted_at", null);
  if (em.taskId) q = q.eq("id", em.taskId);
  else {
    const title = /This is a notification only/.test(em.body) ? em.subject.match(/"([^"]+)"\s*$/)?.[1] : undefined;
    if (!title) return null;
    q = q.eq("title", title);
  }
  const { data } = await q.order("updated_at", { ascending: false }).limit(1);
  const t = data?.[0] as { id: string; client_id: string | null } | undefined;
  return t ? { id: t.id, clientId: t.client_id } : null;
}

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

// Back in Gmail's inbox, or unread there: the same here (the mirror, Derek
// 2026-10-07). A conversation Done or Trashed here comes back when it is in
// Gmail's inbox again (Gmail's snooze ending, moved back by hand), and one
// unread in Gmail is unread here. Anything changed here in the last ten
// minutes is left alone, so Done or read here isn't undone before Gmail has
// caught up with it. Follows the Inbox Settings switches for archive and read.
const SETTLE_MS = 10 * 60_000;
async function syncInboxState(memberId: string, mailbox: string, inInbox: Set<string>): Promise<{ reopened: number; unread: number }> {
  if (!inInbox.size) return { reopened: 0, unread: 0 };
  const { data: pref } = await supabaseAdmin.from("inbox_prefs").select("prefs").eq("member_id", memberId).maybeSingle();
  const prefs = (pref?.prefs ?? {}) as { gmailArchive?: boolean; gmailRead?: boolean };
  const unreadIds = prefs.gmailRead === false ? new Set<string>() : await gmailThreadIds(mailbox, "in:inbox is:unread newer_than:90d", 1);
  const keys = [...inInbox].map((id) => `gm:${id}`);
  const states: any[] = [];
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await supabaseAdmin.from("inbox_state").select("thread_key, done_at, trashed_at, read_at, updated_at").eq("member_id", memberId).in("thread_key", keys.slice(i, i + 200));
    states.push(...(data ?? []));
  }
  const settled = (s: any) => !s.updated_at || Date.now() - Date.parse(s.updated_at) > SETTLE_MS;
  const now = new Date().toISOString();
  const rows: any[] = [];
  let reopened = 0, unread = 0;
  for (const s of states) {
    if (!settled(s)) continue;
    const id = (s.thread_key as string).slice(3);
    const patch: Record<string, unknown> = {};
    if (prefs.gmailArchive !== false && (s.done_at || s.trashed_at)) { patch.done_at = null; patch.trashed_at = null; reopened++; }
    if (prefs.gmailRead !== false && unreadIds.has(id) && s.read_at) { patch.read_at = null; unread++; }
    else if (prefs.gmailRead !== false && !unreadIds.has(id) && !s.read_at) patch.read_at = now;
    if (Object.keys(patch).length) rows.push({ member_id: memberId, thread_key: s.thread_key, ...patch, updated_at: now });
  }
  if (rows.length) {
    const { error } = await supabaseAdmin.from("inbox_state").upsert(rows, { onConflict: "member_id,thread_key" });
    if (error) throw new Error(error.message);
  }
  return { reopened, unread };
}

// Archived or deleted in Gmail: the same conversation leaves this teammate's
// Inbox too, as Done or into Trash (Derek, 2026-10-05: "Gmail archive and
// delete into the Inbox"). The mirror of Inbox Settings' "Done archives it in
// Gmail", so it follows that same switch. Looks only at email from the last
// two weeks that is still open in the Inbox, and only ever closes things: a
// conversation a new email reopens comes back as it always does.
async function clearFromGmail(memberId: string, mailbox: string): Promise<{ archived: number; trashed: number }> {
  const { data: pref } = await supabaseAdmin.from("inbox_prefs").select("prefs").eq("member_id", memberId).maybeSingle();
  if ((pref?.prefs as { gmailArchive?: boolean } | null)?.gmailArchive === false) return { archived: 0, trashed: 0 };
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: rows } = await supabaseAdmin.from("messages").select("gmail_thread_id, created_at")
    .eq("mailbox_member_id", memberId).eq("channel", "email").eq("direction", "inbound").not("gmail_thread_id", "is", null).gte("created_at", since).limit(2000);
  const newest = new Map<string, number>();
  for (const r of rows ?? []) {
    const id = r.gmail_thread_id as string, at = Date.parse(r.created_at as string);
    if (at > (newest.get(id) ?? 0)) newest.set(id, at);
  }
  if (!newest.size) return { archived: 0, trashed: 0 };
  const keys = [...newest.keys()].map((id) => `gm:${id}`);
  const { data: states } = await supabaseAdmin.from("inbox_state").select("thread_key, done_at, trashed_at, snoozed_until").eq("member_id", memberId).in("thread_key", keys);
  const stateOf = new Map((states ?? []).map((s: any) => [s.thread_key as string, s]));
  // Still open here: nothing marks it done or trashed after its newest email.
  const open = [...newest].filter(([id, at]) => {
    const st = stateOf.get(`gm:${id}`);
    const closed = Math.max(st?.done_at ? Date.parse(st.done_at) : 0, st?.trashed_at ? Date.parse(st.trashed_at) : 0);
    // Snoozed here is left alone: it may be out of Gmail's inbox on purpose.
    const snoozed = !!st?.snoozed_until && Date.parse(st.snoozed_until) > Date.now();
    return closed < at && !snoozed;
  });
  if (!open.length) return { archived: 0, trashed: 0 };
  const [inInbox, inTrash] = await Promise.all([gmailThreadIds(mailbox, "in:inbox newer_than:21d"), gmailThreadIds(mailbox, "in:trash newer_than:21d", 1)]);
  // Gmail answered with nothing at all: don't read that as "everything was archived".
  if (!inInbox.size) return { archived: 0, trashed: 0 };
  const now = new Date().toISOString();
  const out = open.filter(([id]) => !inInbox.has(id)).map(([id]) => {
    const trashed = inTrash.has(id);
    const had = stateOf.get(`gm:${id}`);
    return { member_id: memberId, thread_key: `gm:${id}`, ...(trashed ? { trashed_at: now } : { done_at: now }), read_at: now, ...(had ? {} : { snoozed_until: null }), updated_at: now };
  });
  if (!out.length) return { archived: 0, trashed: 0 };
  const { error } = await supabaseAdmin.from("inbox_state").upsert(out, { onConflict: "member_id,thread_key" });
  if (error) throw new Error(error.message);
  const trashed = out.filter((r) => "trashed_at" in r).length;
  return { archived: out.length - trashed, trashed };
}
