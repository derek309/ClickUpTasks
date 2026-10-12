// Steps for the hosted MCP server (Derek, 2026-10-12): ticking a step or a
// to-do, and placing a draft email, run the app's own step rules (stepsServer),
// so work Claude does moves the plan on the same way the task page does.
import { supabaseAdmin } from "./supabaseAdmin";
import { holdDraftOnStep, tickStep, tickTodo } from "./stepsServer";

export function createStepServices({ memberId }: { memberId: string }) {
  let name: Promise<string> | null = null;
  const label = () => (name ??= (async () => {
    const { data } = await supabaseAdmin.from("profiles").select("name").eq("member_id", memberId).maybeSingle();
    return ((data?.name as string | null) ?? "").trim() || "Claude";
  })());
  return {
    tickStep: (taskId: string, stepId: string, done: boolean) => tickStep(taskId, stepId, done),
    tickTodo: async (taskId: string, ref: string, done: boolean) => tickTodo(taskId, ref, done, await label()),
    holdDraftOnStep: (taskId: string, subject: string, step?: string) => holdDraftOnStep(taskId, subject, step),
  };
}
