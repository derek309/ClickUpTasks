// Steps for the hosted MCP server (Derek, 2026-10-12): ticking a step or a
// to-do, and placing a draft email, run the app's own step rules (stepsServer),
// so work Claude does moves the plan on the same way the task page does.
import { supabaseAdmin } from "./supabaseAdmin";
import { holdDraftOnStep, tickStep, tickTodo } from "./stepsServer";
import { sendTaskFileToSite } from "./clientWebsite";
import { tidyLongTitle } from "./tidyTitle";

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
    // A long name made short, the request onto step 1 (lib/tidyTitle, 2026-10-13).
    tidyTitle: (taskId: string) => tidyLongTitle(taskId),
    // A task's picture into the client's website Media Library (Derek, 2026-10-12).
    sendToWebsite: async (taskId: string, file: string) => {
      const r = await sendTaskFileToSite(taskId, file);
      return r.ok ? `${r.name} ${r.already ? "was already" : "is now"} in the website's Media Library: ${r.media.url} (media id ${r.media.id}).` : r.error;
    },
  };
}
