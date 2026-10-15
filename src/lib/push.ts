// SERVER-ONLY: sends phone notifications (Web Push) to the team (Derek,
// 2026-10-15). Best effort everywhere: a push that fails never fails the
// request that caused it, and with the VAPID keys missing every function here
// returns at once, so the feature stays dark until Derek adds them in Vercel:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  the public key (the browser needs it too)
//   VAPID_PRIVATE_KEY             the private key
//   VAPID_SUBJECT                 a mailto: or https: contact for the push
//                                 services, mailto:derek@clickuplocal.com if unset
// Phones subscribe through /api/push/subscribe (supabase/push-subscriptions.sql).
import webpush from "web-push";
import { supabaseAdmin, adminConfigured } from "./supabaseAdmin";
import { CLAUDE_ID, currentStep, needsYou, type Subtask, type TaskStatus } from "./data";
import { claudeFinishedPush, clientWrotePush, type PushPayload } from "./pushPayload";

const DEFAULT_SUBJECT = "mailto:derek@clickuplocal.com";

export function pushConfigured(): boolean {
  return adminConfigured && !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() && !!process.env.VAPID_PRIVATE_KEY?.trim();
}

let vapidSet = false;
function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  if (vapidSet) return true;
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(), process.env.VAPID_PRIVATE_KEY!.trim());
    vapidSet = true;
    return true;
  } catch (e) {
    console.warn("[push] VAPID keys rejected:", e instanceof Error ? e.message : e);
    return false;
  }
}

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

/** Sends one notification to every phone (or browser) these roster members
 *  turned notifications on for. Returns how many went out. Subscriptions the
 *  push service says are gone (404, 410) are deleted. Never throws. */
export async function sendPush(memberIds: (string | null | undefined)[], payload: PushPayload): Promise<number> {
  try {
    const ids = Array.from(new Set(memberIds.filter((m): m is string => !!m && m !== CLAUDE_ID)));
    if (!ids.length || !ensureVapid()) return 0;
    const { data: people } = await supabaseAdmin.from("profiles").select("id").in("member_id", ids);
    const userIds = ((people ?? []) as { id: string }[]).map((p) => p.id);
    if (!userIds.length) return 0;
    const { data: subs, error } = await supabaseAdmin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", userIds);
    if (error || !subs?.length) return 0;
    const body = JSON.stringify(payload);
    const results = await Promise.all((subs as SubRow[]).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60 * 24, urgency: "high", ...(payload.tag ? { topic: topicFor(payload.tag) } : {}) });
        return { id: s.id, ok: true, gone: false };
      } catch (e) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (status !== 404 && status !== 410) console.warn("[push] send failed", status ?? "", e instanceof Error ? e.message : "");
        return { id: s.id, ok: false, gone: status === 404 || status === 410 };
      }
    }));
    const gone = results.filter((r) => r.gone).map((r) => r.id);
    const sent = results.filter((r) => r.ok).map((r) => r.id);
    if (gone.length) await supabaseAdmin.from("push_subscriptions").delete().in("id", gone);
    if (sent.length) await supabaseAdmin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", sent);
    return sent.length;
  } catch (e) {
    console.warn("[push] skipped:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** The Topic header lets a push service drop an older undelivered push with
 *  the same topic (a phone that was off gets the latest, not ten). At most 32
 *  URL safe characters. */
function topicFor(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, "_").slice(-32);
}

async function clientName(clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null;
  const { data } = await supabaseAdmin.from("clients").select("name").eq("id", clientId).maybeSingle();
  return ((data as { name?: string } | null)?.name ?? "").trim() || null;
}

/** The client wrote (a text, an email, a portal message or answer): the same
 *  people the bell rang for get it on their phone. */
export async function pushClientWrote(p: { recipients: (string | null | undefined)[]; text: string; taskId?: string | null; clientId?: string | null }): Promise<void> {
  if (!pushConfigured() || !p.recipients.some(Boolean)) return;
  try {
    await sendPush(p.recipients, clientWrotePush({ text: p.text, taskId: p.taskId, clientId: p.clientId, clientName: await clientName(p.clientId) }));
  } catch { /* best effort */ }
}

/** Claude ticked its step (hosted MCP, lib/stepsServer tickStep): when that
 *  puts the task in someone's Needs you as "Claude finished", tell them. The
 *  same rule the app's Needs you uses (data.ts needsYou), read off the saved
 *  task, so a step that hands on to the client or to Claude again says nothing. */
export async function pushIfClaudeFinished(taskId: string, stepTitle: string): Promise<void> {
  if (!pushConfigured()) return;
  try {
    const { data } = await supabaseAdmin.from("tasks").select("id, title, client_id, status, assignee_id, subtasks").eq("id", taskId).maybeSingle();
    const t = data as { id: string; title: string | null; client_id: string | null; status: string; assignee_id: string | null; subtasks: Subtask[] | null } | null;
    if (!t) return;
    const subtasks = t.subtasks ?? [];
    const task = { status: t.status as TaskStatus, subtasks, assigneeId: t.assignee_id ?? "" };
    const who = currentStep(subtasks)?.assigneeId ?? t.assignee_id;
    if (!who || who === CLAUDE_ID || needsYou(task, who) !== "Claude finished. Your turn") return;
    await sendPush([who], claudeFinishedPush({ stepTitle, taskTitle: t.title ?? "", taskId: t.id, clientId: t.client_id, clientName: await clientName(t.client_id) }));
  } catch { /* best effort */ }
}
