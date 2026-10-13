// SERVER-ONLY: a task named with the whole request gets a short name, and the
// request becomes step 1's directions (Derek, 2026-10-13: "rename the step
// title and move the request to step one, not in description; that's the
// proper way to use the system"). Runs after a task is made or renamed with a
// long name, from the app (db.ts) or Claude (MCP).
import { GEMINI_URL, geminiHeaders } from "./ai";
import { isLongTitle } from "./data";
import { requestOntoStepOne } from "./stepsServer";
import { supabaseAdmin } from "./supabaseAdmin";

const words = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(" ");

/** A short name and a first step for the request, from Gemini; plain cuts of
 *  the request when it is not there or says nothing usable. */
async function namesFor(request: string): Promise<{ title: string; step: string }> {
  const fallback = { title: `${words(request.replace(/[.!?][\s\S]*$/, ""), 8)}`, step: "Work out what is needed" };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback;
  const prompt = [
    "A teammate typed a whole request as a task's name. Give the task a short name and name its first step.",
    'Reply as JSON: {"title": string, "step": string}.',
    "title: what the task delivers, 3 to 8 words, plain words, no dashes, no ending period. Keep names of people, clients and products.",
    "step: the first thing to do, starting with a verb, 3 to 8 words, no dashes.",
    `Request: ${request.slice(0, 2000)}`,
  ].join("\n");
  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST", headers: geminiHeaders(apiKey),
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return fallback;
    const raw: string = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const j = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()) as { title?: unknown; step?: unknown };
    const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s*[—–-]\s*/g, ", ").replace(/[.\s]+$/, "").trim().slice(0, max) : "");
    const title = clean(j.title, 90), step = clean(j.step, 90);
    return { title: title && !isLongTitle(title) ? title : fallback.title, step: step || fallback.step };
  } catch {
    return fallback;
  }
}

/** Shortens a long task name and moves the request onto step 1. False when
 *  the name is not long (or was changed in the meantime). */
export async function tidyLongTitle(taskId: string): Promise<{ ok: boolean; title?: string }> {
  const { data } = await supabaseAdmin.from("tasks").select("title").eq("id", taskId).maybeSingle();
  const request = String((data as { title?: string } | null)?.title ?? "").trim();
  if (!request || !isLongTitle(request)) return { ok: false };
  const { title, step } = await namesFor(request);
  const done = await requestOntoStepOne(taskId, request, title, step);
  return done ? { ok: true, title } : { ok: false };
}
