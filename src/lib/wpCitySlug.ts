// The one place that turns a territory into the city slug WordPress knows it
// by. Four files used to keep their own copy of this (planner push, invite
// links, invite send, and the inbound planner-interest webhook) — when the
// fallback drifts, invites silently go to the wrong city, so it lives here
// once now and every caller imports it.
import { supabaseAdmin } from "./supabaseAdmin";

/** Rough JS approximation of WordPress's PHP sanitize_title() — the fallback
 * used when a territory has no explicit wp_city_slug override. Punctuation and
 * diacritic edge cases can still drift from PHP's own output; that's exactly
 * what the override column is for. */
export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The city slug WordPress expects for a territory: its wp_city_slug override
 * if set, otherwise slugify(city). null when the territory doesn't exist or
 * has neither — callers treat both as the same "nothing to talk to WordPress
 * about" failure, since the UI surfaces either as one error string anyway.
 *
 * Callers that need other columns off the same territory row (assigned_to,
 * state, …) should keep their own single select rather than pay a second
 * round trip for this. */
export async function citySlugForTerritory(territoryId: string): Promise<string | null> {
  const { data: territory } = await supabaseAdmin.from("territories").select("city, wp_city_slug").eq("id", territoryId).maybeSingle();
  if (!territory) return null;
  return (territory.wp_city_slug as string | null) || slugify(String(territory.city ?? "")) || null;
}
