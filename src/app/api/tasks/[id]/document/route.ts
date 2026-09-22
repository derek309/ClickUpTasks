import { NextRequest, NextResponse } from "next/server";
import { adminConfigured } from "@/lib/supabaseAdmin";
import { teamDocAccess, teamActor, kindOf, NO_STORE } from "@/lib/taskDocumentServer";
import {
  createReview, deleteReview, pickReviewVersion, removeReviewVersion, renameReview, reopenReview, setReviewReminders, setReviewStage, writeDocBody,
  type ReviewOutcome,
} from "@/lib/reviewService";
import { DOC_MAX_RAW_CHARS } from "@/lib/docHtml";
import { isFileKind } from "@/lib/reviewKinds";

// The team's side of a task's client review document: create it, save the
// working copy, reopen it after the client approved, or bring back an earlier
// version. ?kind=image and ?kind=page do the same for the task's image and HTML
// reviews, whose working copy is the version file to send next. Reads happen in
// the browser through row level security (db.ts fetchTaskDocument); every write
// comes through here so the HTML is cleaned and an approved document stays locked.
// The rules themselves are in src/lib/reviewService.ts, shared with Claude over MCP.

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const answer = (r: ReviewOutcome<{ document: Record<string, unknown> }>) => r.ok ? json({ document: r.document }) : json({ error: r.error }, r.status);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  return answer(await createReview(access.task, kindOf(req), teamActor(access.user)));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const kind = kindOf(req);
  const actor = teamActor(access.user);

  const text = await req.text();
  if (text.length > DOC_MAX_RAW_CHARS) return json({ error: "This document is too long." }, 413);
  let payload: { body?: unknown; file?: unknown; images?: unknown; removeVersion?: unknown; reopen?: unknown; restoreVersion?: unknown; restoreCheckpoint?: unknown; checkpoint?: unknown; title?: unknown; status?: unknown; reminders?: unknown };
  try { payload = JSON.parse(text) ?? {}; } catch { return json({ error: "Invalid request." }, 400); }

  if (payload.reopen === true) return answer(await reopenReview(id, kind, actor));
  if (typeof payload.status === "string") return answer(await setReviewStage(id, kind, actor, payload.status));
  if (typeof payload.title === "string") return answer(await renameReview(id, kind, actor, payload.title));
  if (payload.reminders !== undefined) return answer(await setReviewReminders(id, kind, actor, payload.reminders));
  if (isFileKind(kind)) {
    if (payload.removeVersion !== undefined) return answer(await removeReviewVersion(id, kind, actor, payload.removeVersion));
    return answer(await pickReviewVersion(id, kind, actor, payload));
  }
  return answer(await writeDocBody(id, actor, payload));
}

// Delete the document (Derek, 2026-09-11: "we also need to be able to delete the
// document", then "restore them for 30 days"). See deleteReview.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminConfigured) return json({ error: "Not configured" }, 501);
  const { id } = await params;
  const access = await teamDocAccess(req, id);
  if (!access.ok) return access.res;
  const r = await deleteReview(id, kindOf(req), teamActor(access.user));
  return r.ok ? json({ ok: true }) : json({ error: r.error }, r.status);
}
