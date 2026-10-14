// SERVER-ONLY: the next step a "what's next?" step's context points to, asked
// of the app's AI once (the Gemini path tidy-title uses) and kept on the step
// as `suggested`, so the card names it (Derek, 2026-10-14). The rule in
// nextStepSuggest is the fallback when the AI is not there or says nothing.
import { GEMINI_URL, geminiHeaders } from "./ai";
import { asksWhatsNext, htmlToText, planSteps, type Subtask } from "./data";
import { nextStepFromContext, whatsNextContext } from "./nextStepSuggest";
import { suggestStepActions } from "./stepSuggest";
import { setSuggestedNext } from "./stepsServer";
import { supabaseAdmin } from "./supabaseAdmin";

async function askAi(context: string, taskTitle: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const prompt = [
    "A task's last step is done and the task asks what to do next. From the notes below, name ONE next step, or none when the notes ask for nothing more.",
    'Reply as JSON: {"step": string}. Empty string for none.',
    "step: starting with a verb, 3 to 10 words, plain words, no dashes, no ending period. Keep names of people, clients, lists and products.",
    `Task: ${taskTitle.slice(0, 200)}`,
    `Notes: ${context.slice(0, 3000)}`,
  ].join("\n");
  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST", headers: geminiHeaders(apiKey),
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const raw: string = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()) as { step?: unknown };
    const step = typeof j.step === "string" ? j.step.replace(/\s*[—–-]\s*/g, ", ").replace(/[.\s]+$/, "").trim().slice(0, 90) : "";
    return step || null;
  } catch {
    return null;
  }
}

/** Works out and keeps the step's suggestion. The name, or null for none. */
export async function suggestNextStep(taskId: string, stepId: string, clientFirst: string): Promise<{ name: string; kind?: string } | null> {
  const { data } = await supabaseAdmin.from("tasks").select("title, description, subtasks").eq("id", taskId).maybeSingle();
  const row = data as { title?: string; description?: string | null; subtasks?: Subtask[] | null } | null;
  const list = row?.subtasks ?? [];
  const step = list.find((x) => x.id === stepId);
  if (!step || !asksWhatsNext(step)) return null;
  if (step.suggested) return step.suggested;
  const plan = planSteps(list);
  const prev = plan.slice(0, plan.findIndex((x) => x.id === stepId)).reverse().find((x) => x.done);
  const context = whatsNextContext({ notes: htmlToText(step.notes ?? ""), prevNotes: htmlToText(prev?.notes ?? ""), description: htmlToText(row?.description ?? "") });
  if (!context) return null;
  const name = (await askAi(context, row?.title ?? "")) ?? nextStepFromContext(context);
  if (!name) return null;
  const kind = suggestStepActions(name, clientFirst)[0]?.kind;
  const suggested = { name, ...(kind ? { kind } : {}) };
  await setSuggestedNext(taskId, stepId, suggested);
  return suggested;
}
