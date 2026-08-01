// SERVER-ONLY thin wrapper around Granola's public API
// (https://docs.granola.ai) — used to fetch a meeting note's full detail
// (attendees, summary, calendar event) once a webhook tells us its id
// changed, or during a manual backfill sync. Read-only; never imported
// client-side (reads GRANOLA_API_KEY).
const GRANOLA_BASE = "https://public-api.granola.ai/v1";

export const granolaConfigured = Boolean(process.env.GRANOLA_API_KEY);

/* eslint-disable @typescript-eslint/no-explicit-any */

export type GranolaNote = {
  id: string;
  title: string | null;
  owner: { name: string | null; email: string | null } | null;
  created_at: string;
  web_url: string | null;
  calendar_event: {
    event_title: string | null;
    invitees: { email: string }[];
    organiser: string | null;
    scheduled_start_time: string | null;
    scheduled_end_time: string | null;
  } | null;
  attendees: { name: string | null; email: string | null }[];
  summary_text: string | null;
  summary_markdown: string | null;
};

async function granolaFetch(path: string): Promise<any> {
  const res = await fetch(`${GRANOLA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.GRANOLA_API_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Granola API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function granolaGetNote(noteId: string): Promise<GranolaNote> {
  return granolaFetch(`/notes/${encodeURIComponent(noteId)}`);
}

// Lightweight list items only (id/title/owner/timestamps) — used by the
// manual backfill sync to discover which notes exist; full detail (attendees,
// summary) is fetched per-note via granolaGetNote.
export async function granolaListNotesSince(createdAfter: string): Promise<{ id: string; title: string | null }[]> {
  const notes: { id: string; title: string | null }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const qs = new URLSearchParams({ created_after: createdAfter, page_size: "30", ...(cursor ? { cursor } : {}) });
    const json = await granolaFetch(`/notes?${qs.toString()}`);
    for (const n of json.notes ?? []) notes.push({ id: n.id, title: n.title ?? null });
    if (!json.hasMore || !json.cursor) break;
    cursor = json.cursor;
  }
  return notes;
}

export async function granolaCreateWebhookEndpoint(url: string): Promise<{ id: string; signing_secret: string }> {
  const res = await fetch(`${GRANOLA_BASE}/webhook-endpoints`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GRANOLA_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ url, scopes: ["personal"], events: ["note.generated", "note.regenerated"] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Granola API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}
