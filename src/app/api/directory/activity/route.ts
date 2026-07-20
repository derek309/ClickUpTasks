import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/serverAuth";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Log an outreach touch against a directory business — the write side of the
// territory funnel. Forwards to the WordPress /sales/listing/{id}/activity
// endpoint (the source of truth for the pipeline), which records the outcome,
// queued next action, follow-up date, and an activity-log entry, then returns
// the updated listing. Keeps /sales authoritative; ClickUpTasks is just a
// second front-end driving it.
//
// Auth: signed-in task-app user (requireUser). The WordPress shared key stays
// server-side. 501 before the env vars are configured.

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
const configured = Boolean(WP_BASE && WP_KEY);

const OUTCOMES = new Set(["emailed", "called", "sms", "visited", "presented", "posted", "won", "lost"]);
const NEXT_ACTIONS = new Set(["email", "call", "sms", "visit", "present", "close"]);

// Map a WP formatted activity_log entry to the shape the UI renders.
export const mapActivityLog = (log: any): any[] =>
  (Array.isArray(log) ? log : []).map((e: any) => ({
    id: String(e.id ?? ""),
    outcomeLabel: String(e.outcome_label ?? ""),
    nextActionLabel: String(e.next_action_label ?? ""),
    dateH: String(e.date_h ?? ""),
    tsH: String(e.ts_h ?? ""),
    user: String(e.user ?? ""),
    note: String(e.note ?? ""),
    amountLabel: String(e.amount_label ?? ""),
  }));

export async function POST(req: NextRequest) {
  const caller = await requireUser(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!configured) return NextResponse.json({ error: "Directory not configured" }, { status: 501 });

  const body = await req.json().catch(() => ({}));
  const listingId = String(body?.listingId ?? "").trim();
  if (!/^\d+$/.test(listingId)) return NextResponse.json({ error: "listingId (numeric) is required" }, { status: 400 });

  const outcome = String(body?.outcome ?? "");
  const nextAction = body?.nextAction; // may be "" to clear, or undefined to leave alone
  if (outcome !== "" && !OUTCOMES.has(outcome)) return NextResponse.json({ error: "bad outcome" }, { status: 400 });
  if (typeof nextAction === "string" && nextAction !== "" && !NEXT_ACTIONS.has(nextAction)) {
    return NextResponse.json({ error: "bad nextAction" }, { status: 400 });
  }

  // The WP endpoint reads snake_case JSON. Only forward keys the caller sent so
  // an omitted next_action/follow-up is left untouched (vs. an explicit "").
  const payload: Record<string, any> = {};
  if (outcome !== "") payload.outcome = outcome;
  if (typeof nextAction === "string") payload.next_action = nextAction;
  if (typeof body?.note === "string") payload.note = body.note;
  if (body?.followupDays !== undefined) payload.followup_days = Math.max(0, Math.min(730, Number(body.followupDays) || 0));
  if (body?.clearFollowup) payload.clear_followup = true;
  if (outcome === "won" && body?.amount !== undefined) payload.amount = Math.max(0, Number(body.amount) || 0);

  const url = `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1/sales/listing/${listingId}/activity`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "X-ClickUpTasks-Key": WP_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Directory write failed", detail: String(e?.message ?? e) }, { status: 502 });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return NextResponse.json({ error: data?.error || `Directory responded ${res.status}` }, { status: 502 });

  const l = data?.listing ?? {};
  return NextResponse.json({
    ok: true,
    listing: {
      id: l.id ?? Number(listingId),
      claimed: Boolean(l.claimed),
      outcome: String(l.outcome ?? ""),
      outcomeLabel: String(l.outcome_label ?? ""),
      nextAction: String(l.next_action ?? ""),
      nextActionLabel: String(l.next_action_label ?? ""),
      followupDue: typeof l.followup_due === "number" ? l.followup_due : 0,
      lastTouched: typeof l.last_touched === "number" ? l.last_touched : 0,
      activityLog: mapActivityLog(l.activity_log),
    },
  });
}
