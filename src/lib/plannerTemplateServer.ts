// Shared core of /api/planner/template{,/generate} — read, save, and
// regenerate the weekly invite email for one territory's city. Same shape as
// joinFunnelServer/plannerInviteServer so a server-only caller can reach it
// without requireUser.
//
// WordPress stores ONE option per (city, week): a single text blob whose first
// line is "Subject: ..." followed by the body with {{merge}} placeholders.
// That's deliberately kept as one blob here too — splitting subject from body
// in the UI would just have to re-join them on save, and the send path
// (cul_sales_build_invite_email) re-splits it on its own anyway.
import { citySlugForTerritory } from "./wpCitySlug";

/* eslint-disable @typescript-eslint/no-explicit-any */

const WP_BASE = process.env.CUL_WP_BASE_URL || "";
const WP_KEY = process.env.CLICKUPTASKS_API_KEY || "";
export const plannerTemplateConfigured = Boolean(WP_BASE && WP_KEY);

export type PlannerTemplateError = { error: string; status: number };

const wpUrl = (path: string) => `${WP_BASE.replace(/\/$/, "")}/wp-json/cul/v1${path}`;
const headers = { "X-ClickUpTasks-Key": WP_KEY, "Content-Type": "application/json", Accept: "application/json" };

// Every call here resolves the same (city, week) pair and then talks to one of
// three sibling WordPress routes — one helper so the guard/fetch/error
// handling isn't written out three times.
// Returns a tagged {ok:true,data} rather than the raw body so a WordPress
// payload that happens to carry its own error/status keys can never be
// mistaken for one of our failures.
async function callWp(territoryId: string, path: string, init: { method: "GET" | "POST"; body?: unknown; query?: Record<string, string> }): Promise<{ ok: true; data: any } | PlannerTemplateError> {
  if (!plannerTemplateConfigured) return { error: "The invite email template isn't configured yet (missing CUL_WP_BASE_URL/CLICKUPTASKS_API_KEY).", status: 501 };
  if (!territoryId.trim()) return { error: "territoryId is required", status: 400 };

  const citySlug = await citySlugForTerritory(territoryId);
  if (!citySlug) return { error: "Territory not found, or it has no city name or wp_city_slug to read the template for.", status: 400 };

  const qs = new URLSearchParams({ city: citySlug, ...(init.query ?? {}) }).toString();
  const url = init.method === "GET" ? `${wpUrl(path)}?${qs}` : wpUrl(path);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers,
      body: init.method === "POST" ? JSON.stringify({ city: citySlug, ...(init.body as object) }) : undefined,
      cache: "no-store",
    });
  } catch (e: any) {
    return { error: `Template request failed: ${String(e?.message ?? e)}`, status: 502 };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return { error: data?.message || data?.error || `WordPress responded ${res.status}`, status: 502 };
  return { ok: true, data: data ?? {} };
}

/** The saved email blob for this week, or "" when nobody has written one yet
 * (WordPress generates one on the fly at send time in that case). */
export async function fetchPlannerTemplateServer(territoryId: string, week: string): Promise<{ email: string } | PlannerTemplateError> {
  const res = await callWp(territoryId, "/sales/templates", { method: "GET", query: { week } });
  if (!("ok" in res)) return res;
  return { email: String(res.data?.email ?? "") };
}

export async function savePlannerTemplateServer(territoryId: string, week: string, value: string): Promise<{ ok: true } | PlannerTemplateError> {
  const res = await callWp(territoryId, "/sales/templates", { method: "POST", body: { week, field: "email", value } });
  if (!("ok" in res)) return res;
  if (!res.data?.ok) return { error: "WordPress did not confirm the save.", status: 502 };
  return { ok: true };
}

/** Draft fresh copy from WordPress's own AI prompt. Deliberately does NOT
 * save — the rep reads it in the textarea first and saves if they like it. */
export async function generatePlannerTemplateServer(territoryId: string, week: string): Promise<{ text: string } | PlannerTemplateError> {
  const res = await callWp(territoryId, "/sales/templates/generate", { method: "POST", body: { week, type: "email" } });
  if (!("ok" in res)) return res;
  const text = String(res.data?.text ?? "");
  if (!res.data?.ok || !text) return { error: "WordPress returned no draft.", status: 502 };
  return { text };
}
