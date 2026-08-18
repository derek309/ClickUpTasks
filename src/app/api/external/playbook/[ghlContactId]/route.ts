import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, adminConfigured } from "@/lib/supabaseAdmin";
import { resolveTrackedClientId, SAFE_CONTACT_ID } from "@/lib/ghlConversationTask";
import { reconcilePlaybookTasksServer } from "@/lib/playbookReconcileServer";
import { verifyClickUpTasksKey } from "@/lib/verifyBridgeKey";
import { PLAYBOOK_ALL_STEPS } from "@/lib/data";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Inbound WordPress -> ClickUpTasks: the owner-facing /my-business/{slug}/
// dashboard's Playbook read. Shared-secret auth, resolved on ghlContactId
// (WP's `ghl_contact_id` listing postmeta, set for every claimed listing by
// cul_claim_sync_to_ghl) rather than a new WP-business-id column —
// resolveTrackedClientId is the existing GHL-contact -> tracked-client
// resolver, already exercised by the inbound message/call/appointment paths.
//
// Deliberately thin response — only key/label/category/done per step, plus
// per-category totals. No assignee, comments, or other internal task fields
// ever leave this route, matching the discipline /waiting/[token] already
// established for the app's other public-facing surface.
//
// Read-only: does NOT auto-promote an unresolved contact into a tracked
// client (a GET shouldn't have side effects) — a business ClickUpTasks has
// never seen before just gets an empty/not-yet-connected response.
export async function GET(req: NextRequest, { params }: { params: Promise<{ ghlContactId: string }> }) {
  if (!adminConfigured) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  if (!verifyClickUpTasksKey(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ghlContactId } = await params;
  if (!ghlContactId) return NextResponse.json({ error: "Missing ghlContactId" }, { status: 400 });
  // This value reaches a PostgREST .or() filter string (resolveTrackedClientId)
  // and is interpolated into a client id — rejected here, at the edge, before
  // either happens, rather than relying on the downstream guard alone.
  if (!SAFE_CONTACT_ID.test(ghlContactId)) return NextResponse.json({ error: "Invalid ghlContactId" }, { status: 400 });

  const fallback = "cl_" + ghlContactId;
  const clientId = await resolveTrackedClientId(ghlContactId, fallback);
  if (clientId === fallback) {
    const { data: existing } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!existing) return NextResponse.json({ notYetConnected: true, categories: {}, steps: [] });
  }

  await reconcilePlaybookTasksServer(clientId);

  const { data: tasks } = await supabaseAdmin.from("tasks").select("playbook_step_key, status").eq("client_id", clientId).not("playbook_step_key", "is", null);
  const done = new Set((tasks ?? []).filter((t: any) => t.status === "done").map((t: any) => t.playbook_step_key as string));

  const categories: Record<string, { done: number; total: number }> = {
    branding: { done: 0, total: 0 }, reputation: { done: 0, total: 0 }, presence: { done: 0, total: 0 }, income: { done: 0, total: 0 },
  };
  const steps = PLAYBOOK_ALL_STEPS.map((step) => {
    const isDone = done.has(step.key);
    categories[step.category].total += 1;
    if (isDone) categories[step.category].done += 1;
    return { key: step.key, label: step.label, category: step.category, done: isDone };
  });

  return NextResponse.json({ categories, steps });
}
