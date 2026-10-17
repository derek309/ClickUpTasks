"use client";

// The app's side of AI in steps: one call to /api/ai/steps, and each step's
// ask made at most once at a time, so opening the page twice, or a render
// while it thinks, never asks again.
import { authedFetch } from "./supabase";
import type { AiAsk3, AiEmailSuggest, AiNext } from "./aiSteps";

export type StepsAnswer = { off?: true; suggest?: AiEmailSuggest; next?: AiNext; ask?: AiAsk3; error?: string };
export type StepsAsk = { kind: "email" | "next" | "ask"; taskId: string; stepId: string; messageId?: string; choices: { key: string; label: string }[] };

const inFlight = new Map<string, Promise<StepsAnswer>>();
/** The key an ask is made once under: kind, step and email. */
export const askKey = (a: Pick<StepsAsk, "kind" | "stepId" | "messageId">) => `${a.kind}:${a.stepId}:${a.messageId ?? ""}`;

export function askSteps(a: StepsAsk, fetcher: (body: StepsAsk) => Promise<StepsAnswer> = post): Promise<StepsAnswer> {
  const key = askKey(a);
  const on = inFlight.get(key);
  if (on) return on;
  const p = fetcher(a).catch(() => ({ error: "failed" }) as StepsAnswer).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function post(body: StepsAsk): Promise<StepsAnswer> {
  const res = await authedFetch("/api/ai/steps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as StepsAnswer;
  return res.ok ? j : { error: j.error ?? `AI ${res.status}` };
}
