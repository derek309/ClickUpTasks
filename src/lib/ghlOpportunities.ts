// SERVER-ONLY. Reads + writes the GoHighLevel "Prospects" (outreach) pipeline
// — the canonical 9-stage sales funnel (New → In Outreach → Engaged → Claimed
// → First Visit → In Trial → Won / Nurture / Lost) that the gameplan defines
// as the source of truth for sales tracking. Lets the territory view show and
// advance each business's funnel stage without leaving ClickUpTasks.
//
// Config comes from the same values the WordPress /sales tool already uses
// (non-secret GHL ids); env-overridable. The bearer token is resolved through
// the existing per-location token store (tokenForLocation), so nothing new is
// stored here.
import { tokenForLocation } from "./ghlTokens";

const GHL = "https://services.leadconnectorhq.com";
const V = "2021-07-28";
const LOCATION_ID = process.env.GHL_PROSPECTS_LOCATION_ID || "GN4HK1ybbTBWcolEjLHl";
const PIPELINE_ID = process.env.GHL_PROSPECTS_PIPELINE_ID || "Tz8NQWRfufxK7RQXoAwT";

export type Stage = { id: string; name: string };
export type OppRef = { opportunityId: string; stageId: string };

async function headers(): Promise<Record<string, string> | null> {
  // Prefer a dedicated Prospects-pipeline token so this never disturbs the
  // existing per-sub-account messaging tokens. Falls back to the shared
  // per-location store if the dedicated var isn't set.
  const token = process.env.GHL_PROSPECTS_TOKEN || (await tokenForLocation(LOCATION_ID));
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, Version: V, Accept: "application/json" };
}

/** The prospects pipeline's ordered stages. Returns [] if the pipeline isn't found. */
export async function getStages(): Promise<Stage[]> {
  const h = await headers();
  if (!h) return [];
  const res = await fetch(`${GHL}/opportunities/pipelines?locationId=${LOCATION_ID}`, { headers: h });
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const pipeline = (data?.pipelines ?? []).find((p: { id: string }) => p.id === PIPELINE_ID);
  if (!pipeline) return [];
  return (pipeline.stages ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));
}

/** Every opportunity in the pipeline, keyed by contactId → its current stage.
 *  One paginated sweep (vs. one lookup per business) so a whole city resolves
 *  in a handful of calls. */
export async function getOppsByContact(): Promise<Record<string, OppRef>> {
  const h = await headers();
  if (!h) return {};
  const byContact: Record<string, OppRef> = {};
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${GHL}/opportunities/search?location_id=${LOCATION_ID}&pipeline_id=${PIPELINE_ID}&limit=100&page=${page}`, { headers: h });
    if (!res.ok) break;
    const data = await res.json().catch(() => null);
    const opps: any[] = Array.isArray(data?.opportunities) ? data.opportunities : []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const o of opps) {
      const cid = o?.contact?.id || o?.contactId;
      if (cid && o?.pipelineStageId) byContact[cid] = { opportunityId: o.id, stageId: o.pipelineStageId };
    }
    if (opps.length < 100) break;
  }
  return byContact;
}

/** Move a business to a stage: update its opportunity if one exists, else
 *  create one in that stage (so an ambassador can start the funnel from the
 *  field). Returns the resulting {opportunityId, stageId} or null on failure. */
export async function setStage(opts: { contactId: string; stageId: string; name: string; opportunityId?: string }): Promise<OppRef | null> {
  const h = await headers();
  if (!h) return null;
  const jsonHeaders = { ...h, "Content-Type": "application/json" };

  if (opts.opportunityId) {
    const res = await fetch(`${GHL}/opportunities/${opts.opportunityId}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ pipelineStageId: opts.stageId }),
    });
    if (!res.ok) return null;
    return { opportunityId: opts.opportunityId, stageId: opts.stageId };
  }

  const res = await fetch(`${GHL}/opportunities/`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      pipelineId: PIPELINE_ID,
      locationId: LOCATION_ID,
      pipelineStageId: opts.stageId,
      contactId: opts.contactId,
      name: opts.name || "Prospect",
      status: "open",
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const id = data?.opportunity?.id || data?.id;
  return id ? { opportunityId: id, stageId: opts.stageId } : null;
}

export const opportunitiesConfigured = () => Boolean(LOCATION_ID && PIPELINE_ID);
