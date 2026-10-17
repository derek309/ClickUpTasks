// Server only: what a list's kind does on its own (mcp/listKinds.mjs).
//
//   makeNextRoundFor  a repeating list's next round, when no round is open:
//                     after a round's last step is done (the app asks, POST
//                     /api/lists/next-round) and in the daily sweep.
//   runListKindsDaily the daily sweep (cron/purge-trash): every repeating
//                     list gets its next round if it is due one, and every
//                     finishing list on a queue has its Now check, so an Up
//                     next task needed within 3 weeks comes up with a date.
//
// Quiet, and harmless, on a database without projects.plan
// (supabase/list-kinds.sql): the reads fail and nothing is written. Each list
// is a handful of task rows, never the whole table.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin";
import { listPlan, makeNextRound, type RoundStore } from "../../mcp/listKinds.mjs";
import { pacificToday, promoteQueueStore, queueSettings } from "../../mcp/queue.mjs";
import { adminQueueStore } from "./queueServer";

const rid = (prefix: string) => prefix + randomUUID().replace(/-/g, "").slice(0, 10);

export const adminRoundStore: RoundStore = {
  async plan(projectId) {
    const { data, error } = await supabaseAdmin.from("projects").select("*").eq("id", projectId).is("deleted_at", null).maybeSingle();
    if (error || !data) return null;
    const r = data as { id: string; client_id: string; name: string; plan?: unknown };
    return { project: { id: r.id, client_id: r.client_id, name: r.name }, plan: r.plan ?? null };
  },
  async rounds(projectId) {
    // Deleted ones too: a round someone deleted is not made again.
    const { data, error } = await supabaseAdmin.from("tasks").select("id, status, deleted_at").eq("project_id", projectId).like("id", "t_rd_%");
    if (error) return null;
    return (data ?? []) as { id: string; status: string; deleted_at: string | null }[];
  },
  async insert(row) {
    const { error } = await supabaseAdmin.from("tasks").insert(row);
    if (!error) return "made";
    // The round's id is the list and its goes out day: someone made it first.
    if (error.code === "23505") return "exists";
    throw error;
  },
};

/** The list's next round, if it is due one. */
export async function makeNextRoundFor(projectId: string) {
  return makeNextRound(adminRoundStore, projectId, { today: pacificToday(), now: new Date().toISOString(), rid });
}

/** The daily sweep over every list with a kind. */
export async function runListKindsDaily(): Promise<{ rounds: number; pulled: number; skipped?: string }> {
  const { data, error } = await supabaseAdmin.from("projects").select("id, plan, queue").is("deleted_at", null).not("plan", "is", null);
  if (error) return { rounds: 0, pulled: 0, skipped: "no plan column yet (supabase/list-kinds.sql)" };
  let rounds = 0, pulled = 0;
  for (const p of (data ?? []) as { id: string; plan: unknown; queue: unknown }[]) {
    const plan = listPlan(p.plan);
    if (plan.kind === "repeats") {
      const r = await makeNextRoundFor(p.id);
      if (r.made) rounds++;
    } else if (plan.kind === "finishes" && queueSettings(p.queue)?.pull) {
      pulled += (await promoteQueueStore(adminQueueStore, p.id)).filter((x) => x.due).length;
    }
  }
  return { rounds, pulled };
}
