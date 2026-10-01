import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { setGmailThreadLabels } from "@/lib/googleMail";
import { parseThreadKey, threadRows, canUseThread } from "@/lib/inboxServer";

// Keeps Gmail in step with the Inbox (Derek, 2026-10-01): opening a message
// marks it read in Gmail, Mark as unread puts it back, and Done archives it
// (out of Gmail's inbox, never deleted). Each person turns these on or off in
// Inbox Settings; the browser only calls this when they are on. Only email in
// the caller's own mailbox is touched. Best effort: a Gmail hiccup never
// stops the Inbox, and the response says how many it moved.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { threadKeys?: string[]; change?: string };
  const change = (["read", "unread", "archive", "unarchive", "star", "unstar"] as const).find((c) => c === b.change) ?? null;
  if (!change) return NextResponse.json({ error: "Unknown change." }, { status: 400 });
  const refs = (b.threadKeys ?? []).slice(0, 100).map(parseThreadKey).filter((r): r is { kind: "gm"; id: string } => r?.kind === "gm");
  const emails = new Map<string, Promise<string | null>>();
  const mailboxOf = (member: string) => {
    if (!emails.has(member)) emails.set(member, Promise.resolve(supabaseAdmin.from("profiles").select("email").eq("member_id", member).maybeSingle()).then(({ data }) => (data?.email as string | null) ?? null));
    return emails.get(member)!;
  };
  let moved = 0;
  const failed: string[] = [];
  const one = async (ref: { kind: "gm"; id: string }) => {
    const rows = await threadRows(ref, caller);
    if (!rows.length || !(await canUseThread(caller, ref, rows))) return;
    const owner = rows.find((r) => r.mailbox_member_id)?.mailbox_member_id as string | undefined;
    const mailbox = owner ? await mailboxOf(owner) : null;
    if (!mailbox) return;
    try { await setGmailThreadLabels(mailbox, ref.id, change); moved++; }
    catch (e) { failed.push(e instanceof Error ? e.message : "failed"); }
  };
  // Five at a time: archiving fifty at once finishes well inside the limit.
  for (let i = 0; i < refs.length; i += 5) await Promise.all(refs.slice(i, i + 5).map(one));
  return NextResponse.json({ ok: true, moved, ...(failed.length ? { failed: failed.slice(0, 3) } : {}) });
}
