// SERVER ONLY. What the Inbox routes share: finding a conversation's rows from
// its key, and who may act on it (supabase/inbox.sql, lib/inbox.ts).
//
// - A Gmail conversation is the caller's when it is in their own mailbox.
// - A GoHighLevel conversation is theirs when it is assigned to them or to
//   nobody, or, for one the timer has not catalogued yet, when they can see
//   its client.
// Admins may act on any conversation, as everywhere else in the app.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AuthedUser } from "@/lib/serverAuth";
import { isClientVisible } from "@/lib/extensionApi";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ThreadRef = { kind: "gm"; id: string } | { kind: "ghl"; id: string };

export function parseThreadKey(key: unknown): ThreadRef | null {
  if (typeof key !== "string") return null;
  const m = key.match(/^(gm|ghl):([\w.:-]{1,200})$/);
  return m ? { kind: m[1] as "gm" | "ghl", id: m[2] } : null;
}

export const MESSAGE_COLS = "id, contact_id, client_id, task_id, channel, direction, subject, body, created_at, gmail_message_id, gmail_thread_id, rfc822_message_id, ghl_conversation_id, mailbox_member_id, peer_name, peer_address";

/** The conversation's rows, newest first. A Gmail thread id is only unique
 *  inside one mailbox, so it is read from the caller's (an admin's reaches
 *  into anyone's). */
export async function threadRows(ref: ThreadRef, caller: AuthedUser): Promise<any[]> {
  let q = supabaseAdmin.from("messages").select(MESSAGE_COLS);
  q = ref.kind === "gm" ? q.eq("gmail_thread_id", ref.id) : q.eq("ghl_conversation_id", ref.id);
  if (ref.kind === "gm" && caller.role !== "admin") q = q.eq("mailbox_member_id", caller.memberId ?? "-");
  const { data } = await q.order("created_at", { ascending: false }).limit(500);
  return data ?? [];
}

export async function ghlConversation(id: string): Promise<any | null> {
  const { data } = await supabaseAdmin.from("ghl_conversations").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

/** May the caller read and act on this conversation? */
export async function canUseThread(caller: AuthedUser, ref: ThreadRef, rows: any[], conv?: any | null): Promise<boolean> {
  if (caller.role === "admin") return true;
  if (!caller.memberId) return false;
  if (ref.kind === "gm") return rows.some((r) => r.mailbox_member_id === caller.memberId);
  const c = conv === undefined ? await ghlConversation(ref.id) : conv;
  if (c) return !c.assigned_member_id || c.assigned_member_id === caller.memberId;
  const clientId = rows.find((r) => r.client_id)?.client_id as string | undefined;
  return !!clientId && (await isClientVisible(caller, clientId));
}

/** The task the conversation is linked to: the newest row that has one. */
export const linkedTaskId = (rows: any[]): string | null => (rows.find((r) => r.task_id)?.task_id as string | undefined) ?? null;

/** The person on the other end, from the conversation's own rows. */
export function peerOf(rows: any[], conv?: any | null): { contactId: string | null; clientId: string | null; name: string | null; address: string | null } {
  const withContact = rows.find((r) => r.contact_id);
  const inbound = rows.find((r) => r.direction === "inbound" && r.peer_address) ?? rows.find((r) => r.peer_address);
  return {
    contactId: (withContact?.contact_id as string | undefined) ?? null,
    clientId: (rows.find((r) => r.client_id)?.client_id as string | undefined) ?? null,
    name: (inbound?.peer_name as string | undefined) ?? conv?.contact_name ?? null,
    address: (inbound?.peer_address as string | undefined) ?? conv?.phone ?? conv?.email ?? null,
  };
}

/** GoHighLevel's message type for a reply on each of its channels. A missed
 *  call is answered by text. */
export const GHL_SEND_TYPE: Record<string, string> = { sms: "SMS", call: "SMS", fb: "FB", ig: "IG", web: "Live_Chat", gbp: "GMB" };

/** An address used with ilike as a case-blind equals: its % and _ are
 *  letters, not wildcards, so "a_b@x.com" never matches "axb@x.com". */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
