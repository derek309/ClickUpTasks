"use client";

// The /sales-style directory view for a single territory (city). Live-fetches
// the ClickUpLocal directory (GeoDirectory) listings for the city from the
// WordPress side via /api/directory/listings and buckets the businesses the
// way the field-sales tool does:
//   • Claimed   — the owner has claimed their directory listing
//   • Unclaimed — a listing nobody has claimed yet (a prospect to call)
//   • No listing — a GHL contact in this city that matches no directory listing
// A matched business that we've already onboarded (a tracked client, i.e.
// clients.id === "cl_"+contactId) gets a ✓ Client badge on top of its bucket.
//
// When the directory isn't configured (the endpoint 501s before Derek sets the
// WP env vars) or errors, it degrades to showing every city contact under
// "No listing" — exactly the pre-directory behavior, just relabeled.
import { useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { clientStatusMeta, type Contact, type Client } from "@/lib/data";
import { I } from "./ui";

export type DirectoryListing = {
  id: number | string;
  name: string;
  phone: string;
  email: string;
  city: string;
  street: string;
  claimed: boolean;
  hasOffer: boolean;
  score: number | null;
  category: string;
  // Outreach pipeline (from /sales — source of truth)
  outcome: string;
  outcomeLabel: string;
  nextAction: string;
  nextActionLabel: string;
  followupDue: number;  // unix seconds, 0 = none
  lastTouched: number;  // unix seconds, 0 = never
};

// Mirrors the /sales vocabulary (cul_sales_outcomes / cul_sales_next_actions).
export const OUTCOMES: [string, string][] = [
  ["emailed", "Emailed"], ["called", "Called"], ["sms", "SMS'd"], ["visited", "Visited"],
  ["presented", "Appointment"], ["posted", "Posted"], ["won", "Won"], ["lost", "Lost"],
];
export const NEXT_ACTIONS: [string, string][] = [
  ["email", "Email"], ["call", "Call"], ["sms", "SMS"], ["visit", "Visit"], ["present", "Appointment"], ["close", "Close"],
];

// Returns { label, overdue }. Kept a module-scope helper (not computed in the
// component body) so its Date.now() read doesn't trip react-hooks/purity.
const fmtDue = (unix: number): { label: string; overdue: boolean } => {
  if (!unix) return { label: "", overdue: false };
  const days = Math.round((unix * 1000 - Date.now()) / 86400000);
  if (days < 0) return { label: `overdue ${-days}d`, overdue: true };
  if (days === 0) return { label: "due today", overdue: false };
  if (days === 1) return { label: "due tomorrow", overdue: false };
  return { label: `due in ${days}d`, overdue: false };
};

// Last 10 digits — normalizes (555) 123-4567 / +1 555 123 4567 / 5551234567 to
// the same key so a listing and a GHL contact match despite formatting.
const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
const lc = (s: string | undefined) => (s ?? "").trim().toLowerCase();

type Bucket = "unclaimed" | "claimed" | "none";
type SortKey = "score" | "name";

export default function TerritoryDirectory({ city, state, contacts, clients, onAddContact, onOpenClient }: {
  city: string;
  state: string;
  contacts: Contact[];   // already scoped to this city/state by the caller
  clients: Client[];
  onAddContact: (contact: Contact) => void;
  onOpenClient: (clientId: string) => void;
}) {
  const [listings, setListings] = useState<DirectoryListing[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [sort, setSort] = useState<SortKey>("score");

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setErr(null); setNotConfigured(false);
    const qs = new URLSearchParams({ city, state });
    authedFetch(`/api/directory/listings?${qs.toString()}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.status === 501) { setNotConfigured(true); setListings([]); return; }
        if (!res.ok) { setErr(body?.error || `Directory error ${res.status}`); setListings([]); return; }
        setListings(Array.isArray(body.listings) ? body.listings : []);
      })
      .catch((e) => { if (alive) { setErr(String(e?.message ?? e)); setListings([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [city, state]);

  // Patch one listing in place after a logged touch returns the fresh state
  // from /sales — keeps the funnel accurate without a full refetch.
  const patchListing = (id: number | string, next: Partial<DirectoryListing>) =>
    setListings((ls) => (ls ?? []).map((l) => (l.id === id ? { ...l, ...next } : l)));

  const clientIds = useMemo(() => new Set(clients.map((c) => c.id)), [clients]);

  // Match each listing to a city contact (phone → email → name). A contact can
  // back at most one listing; first match wins. Track which contacts got
  // matched so the leftovers form the "No listing" bucket.
  const { rows, matchedContactIds } = useMemo(() => {
    const byPhone = new Map<string, Contact>();
    const byEmail = new Map<string, Contact>();
    const byName = new Map<string, Contact>();
    for (const c of contacts) {
      const p = digits(c.phone); if (p) byPhone.set(p, c);
      const e = lc(c.email); if (e) byEmail.set(e, c);
      const n = lc(c.name); if (n && !byName.has(n)) byName.set(n, c);
    }
    const matched = new Set<string>();
    const out = (listings ?? []).map((l) => {
      const c = byPhone.get(digits(l.phone)) ?? byEmail.get(lc(l.email)) ?? byName.get(lc(l.name)) ?? null;
      if (c) matched.add(c.id);
      const client = c && clientIds.has("cl_" + c.id) ? clients.find((cl) => cl.id === "cl_" + c.id) ?? null : null;
      return { listing: l, contact: c, client };
    });
    return { rows: out, matchedContactIds: matched };
  }, [listings, contacts, clients, clientIds]);

  // "No listing" = city contacts that matched no directory listing.
  const noListing = useMemo(() => contacts.filter((c) => !matchedContactIds.has(c.id)), [contacts, matchedContactIds]);

  const claimed = rows.filter((r) => r.listing.claimed);
  const unclaimed = rows.filter((r) => !r.listing.claimed);

  const sortRows = <T extends { listing: DirectoryListing }>(arr: T[]) =>
    [...arr].sort((a, b) => sort === "name"
      ? a.listing.name.localeCompare(b.listing.name)
      : (b.listing.score ?? -1) - (a.listing.score ?? -1) || a.listing.name.localeCompare(b.listing.name));

  const counts = { claimed: claimed.length, unclaimed: unclaimed.length, none: noListing.length };

  if (loading) return <div className="py-6 text-center text-[13px] text-muted">Loading directory for {city}…</div>;

  return (
    <div className="space-y-3">
      {/* Bucket filter pills + sort */}
      <div className="flex flex-wrap items-center gap-1.5">
        {([["all", `All · ${counts.claimed + counts.unclaimed + counts.none}`], ["unclaimed", `Unclaimed · ${counts.unclaimed}`], ["claimed", `Claimed · ${counts.claimed}`], ["none", `No listing · ${counts.none}`]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setBucket(v)} className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${bucket === v ? "border-accent bg-accent-soft text-accent" : "text-muted hover:bg-background"}`}>{label}</button>
        ))}
        <span className="ml-auto inline-flex overflow-hidden rounded-md border text-[12px]">
          {(["score", "name"] as const).map((k) => (
            <button key={k} onClick={() => setSort(k)} className={`px-2 py-1 font-medium ${sort === k ? "bg-accent-soft text-accent" : "text-muted hover:bg-background"}`}>{k === "score" ? "Score" : "A–Z"}</button>
          ))}
        </span>
      </div>

      {notConfigured && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50/50 px-3 py-2 text-[12px] text-amber-800">
          Directory not connected yet — showing city contacts only. Set <code>CUL_WP_BASE_URL</code> + <code>CLICKUPTASKS_API_KEY</code> to pull listing/claimed status.
        </div>
      )}
      {err && <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">Couldn&apos;t load the directory: {err}</div>}

      {/* Unclaimed (prospects) */}
      {(bucket === "all" || bucket === "unclaimed") && counts.unclaimed > 0 && (
        <Section title="Unclaimed" hint="listings nobody has claimed — prospects to call">
          {sortRows(unclaimed).map((r) => <ListingRow key={r.listing.id} row={r} onAddContact={onAddContact} onOpenClient={onOpenClient} onPatch={patchListing} />)}
        </Section>
      )}

      {/* Claimed */}
      {(bucket === "all" || bucket === "claimed") && counts.claimed > 0 && (
        <Section title="Claimed" hint="owner has claimed their directory listing">
          {sortRows(claimed).map((r) => <ListingRow key={r.listing.id} row={r} onAddContact={onAddContact} onOpenClient={onOpenClient} onPatch={patchListing} />)}
        </Section>
      )}

      {/* No listing */}
      {(bucket === "all" || bucket === "none") && counts.none > 0 && (
        <Section title="No listing" hint="contacts in this city with no directory listing">
          {noListing.map((c) => {
            const client = clientIds.has("cl_" + c.id) ? clients.find((cl) => cl.id === "cl_" + c.id) ?? null : null;
            return (
              <div key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[15px]">
                <span className="min-w-0 flex-1 truncate">{c.name}{c.company && <span className="text-muted/70"> · {c.company}</span>}</span>
                {client ? (
                  <button onClick={() => onOpenClient(client.id)} className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft">✓ Client</button>
                ) : (
                  <button onClick={() => onAddContact(c)} className="shrink-0 rounded-md border border-dashed px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft">+ Add as client</button>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {!loading && counts.claimed + counts.unclaimed + counts.none === 0 && (
        <div className="py-6 text-center text-[13px] text-muted">No directory listings or contacts in {city} yet.</div>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2 px-1">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</span>
        <span className="truncate text-[11px] text-muted/70">{hint}</span>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ListingRow({ row, onAddContact, onOpenClient, onPatch }: {
  row: { listing: DirectoryListing; contact: Contact | null; client: Client | null };
  onAddContact: (c: Contact) => void;
  onOpenClient: (id: string) => void;
  onPatch: (id: number | string, next: Partial<DirectoryListing>) => void;
}) {
  const { listing, contact, client } = row;
  const meta = client ? clientStatusMeta(client.status) : null;
  const [logOpen, setLogOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [followupDays, setFollowupDays] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const due = fmtDue(listing.followupDue);

  const submit = async () => {
    if (!outcome && !nextAction && !followupDays.trim() && !note.trim()) { setLogOpen(false); return; }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = { listingId: String(listing.id) };
      if (outcome) body.outcome = outcome;
      if (nextAction) body.nextAction = nextAction;
      if (note.trim()) body.note = note.trim();
      if (followupDays.trim()) body.followupDays = Number(followupDays) || 0;
      const res = await authedFetch("/api/directory/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { setError(data?.error || `Error ${res.status}`); return; }
      onPatch(listing.id, data.listing);
      setLogOpen(false); setOutcome(""); setNextAction(""); setFollowupDays(""); setNote("");
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg px-2 py-1.5 text-[15px] hover:bg-background">
      <div className="flex items-center gap-2">
        {listing.claimed
          ? <span title="Directory listing claimed" className="shrink-0 text-emerald-500"><I.check /></span>
          : <span title="Unclaimed listing" className="h-2 w-2 shrink-0 rounded-full border border-muted/50" />}
        <span className="min-w-0 flex-1 truncate">
          {listing.name}
          {listing.category && <span className="text-muted/70"> · {listing.category}</span>}
        </span>
        {typeof listing.score === "number" && <span title="ClickUpLocal score" className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted">{listing.score}</span>}
        <button onClick={() => setLogOpen((o) => !o)} title="Log an outreach touch" className="shrink-0 rounded-md border px-2 py-1 text-[12px] font-medium text-muted hover:bg-surface hover:text-foreground">Log</button>
        {client && meta
          ? <button onClick={() => onOpenClient(client.id)} className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft"><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: meta.dot }} />✓ Client</button>
          : contact
            ? <button onClick={() => onAddContact(contact)} className="shrink-0 rounded-md border border-dashed px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent-soft">+ Add as client</button>
            : <span className="shrink-0 text-[11px] text-muted/60">no contact</span>}
      </div>

      {/* Current pipeline state line */}
      {(listing.outcomeLabel || listing.nextActionLabel || listing.followupDue > 0) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 pl-6 text-[11px]">
          {listing.outcomeLabel && <span className="rounded bg-background px-1.5 py-0.5 font-medium text-muted">{listing.outcomeLabel}</span>}
          {listing.nextActionLabel && <span className="rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">→ {listing.nextActionLabel}</span>}
          {due.label && <span className={`px-1 ${due.overdue ? "font-medium text-danger" : "text-muted"}`}>{due.label}</span>}
        </div>
      )}

      {/* Log-touch form */}
      {logOpen && (
        <div className="mt-2 space-y-2 rounded-lg border bg-surface p-2 pl-6">
          <div className="flex flex-wrap gap-2">
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-accent">
              <option value="">Outcome…</option>
              {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-accent">
              <option value="">Next action…</option>
              {NEXT_ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={followupDays} onChange={(e) => setFollowupDays(e.target.value.replace(/\D/g, ""))} placeholder="Follow-up (days)" inputMode="numeric"
              className="w-32 rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-accent" />
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            className="w-full rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-accent" />
          {error && <div className="text-[12px] text-danger">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setLogOpen(false)} className="rounded-md border px-2.5 py-1 text-[13px] font-medium hover:bg-background">Cancel</button>
            <button onClick={submit} disabled={saving} className="rounded-md bg-accent px-2.5 py-1 text-[13px] font-medium text-white disabled:opacity-40">{saving ? "Saving…" : "Log touch"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
