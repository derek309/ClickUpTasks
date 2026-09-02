"use client";

import { useEffect, useState } from "react";
import { type Client } from "@/lib/data";
import { authedFetch, supabase } from "@/lib/supabase";

export default function SettingsPanel({
  clients,
  onSaveClient,
  onSynced,
}: {
  clients: Client[];
  onSaveClient: (c: Client) => void;
  onSynced: () => void | Promise<void>;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [tokenLocations, setTokenLocations] = useState<string[]>([]);
  const [granolaApiKeyConfigured, setGranolaApiKeyConfigured] = useState<boolean | null>(null);
  const [granolaWebhookConfigured, setGranolaWebhookConfigured] = useState<boolean | null>(null);
  // Backfilling walks contacts through GoHighLevel's API one at a time, so it
  // reports progress rather than spinning: remaining is what tells you whether
  // to press it again.
  const [backfill, setBackfill] = useState<{ kind: "idle" | "busy" | "ok" | "err"; msg?: string; remaining?: number }>({ kind: "idle" });
  const [granolaStatus, setGranolaStatus] = useState<{ kind: "idle" | "busy" | "ok" | "err"; msg?: string }>({ kind: "idle" });
  const [locs, setLocs] = useState<Record<string, string>>(() => Object.fromEntries(clients.map((c) => [c.id, c.ghlLocationId || ""])));
  const [status, setStatus] = useState<Record<string, { kind: "idle" | "busy" | "ok" | "err"; msg?: string }>>({});
  const [tokens, setTokens] = useState<Record<string, string>>({});
  // Once a sub-account is connected, collapse the token form to a single
  // Sync button — showing both a live token field and Connect+Sync side by
  // side for an already-connected account was the confusing part.
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  // The Sales checklist was retired Aug 4, 2026 — superseded by the new
  // "Free Marketing Package" section at the top of the Playbook. This is a
  // one-time cleanup for the leftover p_sales_* projects/tasks it left
  // behind; nothing creates new ones anymore. Count-then-confirm-then-delete
  // so a stray click can't silently wipe data.
  const [salesCleanup, setSalesCleanup] = useState<
    { kind: "idle" } | { kind: "counting" } | { kind: "confirm"; tasks: number; projects: number } | { kind: "busy" } | { kind: "done"; tasks: number; projects: number } | { kind: "err"; msg: string }
  >({ kind: "idle" });

  async function countSalesLists() {
    setSalesCleanup({ kind: "counting" });
    const [{ count: taskCount, error: taskErr }, { count: projectCount, error: projErr }] = await Promise.all([
      supabase.from("tasks").select("id", { count: "exact", head: true }).not("sales_step_key", "is", null),
      supabase.from("projects").select("id", { count: "exact", head: true }).like("id", "p_sales_%"),
    ]);
    if (taskErr || projErr) { setSalesCleanup({ kind: "err", msg: (taskErr ?? projErr)!.message }); return; }
    setSalesCleanup({ kind: "confirm", tasks: taskCount ?? 0, projects: projectCount ?? 0 });
  }

  async function deleteSalesLists() {
    setSalesCleanup({ kind: "busy" });
    const { error: taskErr, count: tasksDeleted } = await supabase.from("tasks").delete({ count: "exact" }).not("sales_step_key", "is", null);
    if (taskErr) { setSalesCleanup({ kind: "err", msg: taskErr.message }); return; }
    const { error: projErr, count: projectsDeleted } = await supabase.from("projects").delete({ count: "exact" }).like("id", "p_sales_%");
    if (projErr) { setSalesCleanup({ kind: "err", msg: projErr.message }); return; }
    setSalesCleanup({ kind: "done", tasks: tasksDeleted ?? 0, projects: projectsDeleted ?? 0 });
  }

  useEffect(() => {
    authedFetch("/api/ghl/status").then((r) => r.json()).then((j) => { setConfigured(!!j.configured); setTokenLocations(j.locations ?? []); }).catch(() => setConfigured(false));
    authedFetch("/api/granola/status").then((r) => r.json()).then((j) => { setGranolaApiKeyConfigured(!!j.apiKeyConfigured); setGranolaWebhookConfigured(!!j.webhookConfigured); }).catch(() => { setGranolaApiKeyConfigured(false); setGranolaWebhookConfigured(false); });
  }, []);

  // Registers this deployment's /api/granola/webhook URL with Granola —
  // returns a signing_secret shown only once. It's surfaced here (not
  // silently stored) because it still has to be added as
  // GRANOLA_WEBHOOK_SECRET in the Vercel project env and redeployed before
  // the webhook route can verify anything.
  async function connectGranola() {
    setGranolaStatus({ kind: "busy" });
    try {
      const res = await authedFetch("/api/granola/setup-webhook", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Webhook setup failed");
      setGranolaStatus({ kind: "ok", msg: `Registered. Signing secret (copy now, shown once): ${j.signingSecret}` });
    } catch (e) {
      setGranolaStatus({ kind: "err", msg: e instanceof Error ? e.message : "Webhook setup failed" });
    }
  }

  // One pass, capped server-side. Deliberately not a loop that runs to
  // completion: this is dozens of calls to someone else's API, and a button
  // you press again is easier to stop than a run that has decided to keep
  // going.
  async function backfillConversations() {
    setBackfill({ kind: "busy" });
    try {
      const res = await authedFetch("/api/ghl/backfill-conversations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 10 }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Backfill failed");
      const failed = (j.results ?? []).filter((r: { error?: string }) => r.error).length;
      // Blocked is not the same as failed. A sub-account with no token is not
      // something pressing the button again will fix, and saying "could not be
      // reached" about it made a finished run look broken.
      const blocked = (j.blockedNoToken ?? 0) + (j.blockedNoIds ?? 0);
      const blockedNote = blocked
        ? ` ${blocked} client${blocked === 1 ? "" : "s"} skipped: ${j.blockedNoToken ?? 0} not found in any connected sub-account${j.blockedNoIds ? `, ${j.blockedNoIds} with no GoHighLevel contact id` : ""}.`
        : "";
      setBackfill({
        kind: "ok",
        remaining: j.remaining ?? 0,
        msg: `${j.contactsProcessed} client${j.contactsProcessed === 1 ? "" : "s"} checked, ${j.bound} message${j.bound === 1 ? "" : "s"} linked`
          + (failed ? `, ${failed} errored` : "")
          + (j.remaining ? ` — ${j.remaining} still to go.` : ". Nothing left to link.")
          + blockedNote,
      });
    } catch (e) {
      setBackfill({ kind: "err", msg: e instanceof Error ? e.message : "Backfill failed" });
    }
  }

  async function syncGranolaNow() {
    setGranolaStatus({ kind: "busy" });
    try {
      const res = await authedFetch("/api/granola/sync", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Sync failed");
      setGranolaStatus({ kind: "ok", msg: `Checked ${j.checked} — ${j.created} added, ${j.unmatched} unmatched, ${j.internal} internal-only, ${j.skipped} already synced${j.failed ? `, ${j.failed} failed` : ""}.` });
    } catch (e) {
      setGranolaStatus({ kind: "err", msg: e instanceof Error ? e.message : "Sync failed" });
    }
  }

  function setLoc(clientId: string, v: string) {
    setLocs((s) => ({ ...s, [clientId]: v }));
  }

  async function connect(client: Client) {
    const locationId = (locs[client.id] || "").trim();
    const token = (tokens[client.id] || "").trim();
    if (!locationId || !token) { setStatus((s) => ({ ...s, [client.id]: { kind: "err", msg: "Enter both a Location ID and a token" } })); return; }
    if (locationId !== client.ghlLocationId) onSaveClient({ ...client, ghlLocationId: locationId });
    setStatus((s) => ({ ...s, [client.id]: { kind: "busy" } }));
    try {
      const res = await authedFetch("/api/ghl/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId, token }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Connect failed");
      setTokenLocations((l) => Array.from(new Set([...l, locationId])));
      setTokens((t) => ({ ...t, [client.id]: "" }));
      setEditing((e) => ({ ...e, [client.id]: false }));
      setStatus((s) => ({ ...s, [client.id]: { kind: "ok", msg: "Connected — hit Sync to pull contacts." } }));
    } catch (e) {
      setStatus((s) => ({ ...s, [client.id]: { kind: "err", msg: e instanceof Error ? e.message : "Connect failed" } }));
    }
  }

  async function sync(client: Client) {
    const locationId = (locs[client.id] || "").trim();
    if (!locationId) { setStatus((s) => ({ ...s, [client.id]: { kind: "err", msg: "Enter a Location ID first" } })); return; }
    // persist the location on the client
    if (locationId !== client.ghlLocationId) onSaveClient({ ...client, ghlLocationId: locationId });
    setStatus((s) => ({ ...s, [client.id]: { kind: "busy" } }));
    try {
      const res = await authedFetch("/api/ghl/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, locationId }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Sync failed");
      // A 200 can still carry a partial-failure message (sync.route.ts saves
      // whatever it collected before a page failed, rather than losing it).
      setStatus((s) => ({ ...s, [client.id]: { kind: j.error ? "err" : "ok", msg: j.error ?? `Synced ${j.synced} contact${j.synced === 1 ? "" : "s"}` } }));
      await onSynced();
    } catch (e) {
      setStatus((s) => ({ ...s, [client.id]: { kind: "err", msg: e instanceof Error ? e.message : "Sync failed" } }));
    }
  }

  return (
    <div className="px-5 py-3">
      <div className="mb-3 flex items-center gap-2">
            <span className="text-[15px] font-semibold">GoHighLevel</span>
            {configured === null ? (
              <span className="text-[13px] text-muted">checking…</span>
            ) : configured ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[15px] font-medium text-green-600"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Token connected</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[15px] font-medium text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Token not set</span>
            )}
          </div>

          {configured === false && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[15px] text-amber-800">
              <div className="font-medium">Add your GoHighLevel token to finish connecting.</div>
              <div className="mt-1 text-amber-700">In each sub-account: <b>Settings → Private Integrations → Create</b>, enable the <b>Contacts</b> (and Tasks) scopes, copy the <code>pit-…</code> token. Then paste the <b>Location ID</b> + <b>token</b> below, hit <b>Connect</b>, then <b>Sync</b>. Tokens are stored server-side only — never in the browser.</div>
            </div>
          )}

          <div className="space-y-2">
            {clients.map((c) => {
              const st = status[c.id];
              const loc = (locs[c.id] || "").trim();
              const connected = !!loc && tokenLocations.includes(loc);
              // Not-yet-connected accounts always show the form (nothing to
              // collapse to); connected ones start collapsed and only show
              // it again if you explicitly ask to change the token.
              const showForm = !connected || editing[c.id];
              return (
                <div key={c.id} className="rounded-lg border bg-background px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="truncate text-[15px] font-medium">{c.name}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[13px] font-medium ${connected ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-700"}`}>
                      {connected ? "Connected" : "Not connected"}
                    </span>
                  </div>

                  {showForm ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input value={locs[c.id] ?? ""} onChange={(e) => setLoc(c.id, e.target.value)} placeholder="Location ID"
                        className="w-40 rounded-md border bg-surface px-2 py-1 text-[15px] outline-none focus:border-accent" />
                      <input type="password" value={tokens[c.id] ?? ""} onChange={(e) => setTokens((t) => ({ ...t, [c.id]: e.target.value }))} placeholder="pit-… token"
                        className="min-w-0 flex-1 rounded-md border bg-surface px-2 py-1 text-[15px] outline-none focus:border-accent" />
                      <button onClick={() => connect(c)} disabled={st?.kind === "busy"}
                        className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[15px] font-medium text-white disabled:opacity-50">
                        {st?.kind === "busy" ? "Connecting…" : "Connect"}</button>
                      {connected && (
                        <button onClick={() => setEditing((e) => ({ ...e, [c.id]: false }))} className="shrink-0 text-[13px] text-muted hover:text-foreground">Cancel</button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <button onClick={() => sync(c)} disabled={st?.kind === "busy"}
                        className="shrink-0 rounded-md bg-accent px-3 py-1 text-[15px] font-medium text-white disabled:opacity-50">
                        {st?.kind === "busy" ? "Syncing…" : "Sync"}</button>
                      <button onClick={() => setEditing((e) => ({ ...e, [c.id]: true }))} className="text-[13px] text-muted hover:text-foreground hover:underline">Change token</button>
                    </div>
                  )}

                  {st && st.kind !== "busy" && (
                    <div className={`mt-1.5 text-[15px] ${st.kind === "ok" ? "text-green-600" : "text-red-500"}`}>{st.msg}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mb-3 mt-6 flex items-center gap-2">
            <span className="text-[15px] font-semibold">Granola</span>
            {granolaApiKeyConfigured === null ? (
              <span className="text-[13px] text-muted">checking…</span>
            ) : !granolaApiKeyConfigured ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[15px] font-medium text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> API key not set</span>
            ) : granolaWebhookConfigured ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[15px] font-medium text-green-600"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Connected</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[15px] font-medium text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Webhook not registered</span>
            )}
          </div>
          <div className="rounded-lg border bg-background px-3 py-2.5">
            <p className="text-[13px] text-muted">
              Meeting notes sync into a client&apos;s Journal automatically once a meeting&apos;s attendees match a known contact.
              {!granolaWebhookConfigured && granolaApiKeyConfigured && " Click Connect once to register the webhook, then add the returned signing secret as GRANOLA_WEBHOOK_SECRET."}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {granolaApiKeyConfigured && !granolaWebhookConfigured && (
                <button onClick={connectGranola} disabled={granolaStatus.kind === "busy"}
                  className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[15px] font-medium text-white disabled:opacity-50">
                  {granolaStatus.kind === "busy" ? "Connecting…" : "Connect"}</button>
              )}
              {granolaApiKeyConfigured && (
                <button onClick={syncGranolaNow} disabled={granolaStatus.kind === "busy"}
                  className="shrink-0 rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-surface disabled:opacity-50">
                  {granolaStatus.kind === "busy" ? "Syncing…" : "Sync recent meetings"}</button>
              )}
            </div>
            {granolaStatus.kind !== "busy" && granolaStatus.msg && (
              <div className={`mt-1.5 break-all text-[15px] ${granolaStatus.kind === "ok" ? "text-green-600" : "text-red-500"}`}>{granolaStatus.msg}</div>
            )}
          </div>

          <div className="mb-3 mt-6 flex items-center gap-2">
            <span className="text-[15px] font-semibold">Data cleanup</span>
          </div>
          <div className="mb-2 rounded-lg border bg-background px-3 py-2.5">
            <p className="text-[13px] text-muted">
              Messages that arrived before conversations were linked to tasks have no thread to follow, so a reply to one
              lands on a general &quot;Reply to&quot; task instead of the task it belongs to. This asks GoHighLevel which
              conversation each old message came from. Safe to run more than once — anything already linked is skipped.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={backfillConversations} disabled={backfill.kind === "busy"}
                className="shrink-0 rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-surface disabled:opacity-50">
                {backfill.kind === "busy" ? "Linking…" : backfill.remaining ? "Link the next 10 clients" : "Link old conversations"}
              </button>
            </div>
            {backfill.kind !== "busy" && backfill.msg && (
              <div className={`mt-1.5 text-[15px] ${backfill.kind === "ok" ? "text-green-600" : "text-red-500"}`}>{backfill.msg}</div>
            )}
          </div>
          <div className="rounded-lg border bg-background px-3 py-2.5">
            <p className="text-[13px] text-muted">
              The old Sales checklist was retired — every business now works through the Free Marketing Package section at the top of its Playbook instead. This permanently deletes the leftover Sales lists it left behind on existing clients.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {salesCleanup.kind === "confirm" ? (
                <>
                  <span className="text-[15px] font-medium text-amber-700">
                    Delete {salesCleanup.projects} Sales list{salesCleanup.projects === 1 ? "" : "s"} and {salesCleanup.tasks} task{salesCleanup.tasks === 1 ? "" : "s"}? This can&apos;t be undone.
                  </span>
                  <button onClick={deleteSalesLists} className="shrink-0 rounded-md bg-red-600 px-2.5 py-1 text-[15px] font-medium text-white hover:bg-red-700">
                    Yes, delete them
                  </button>
                  <button onClick={() => setSalesCleanup({ kind: "idle" })} className="shrink-0 text-[13px] text-muted hover:text-foreground">Cancel</button>
                </>
              ) : (
                <button onClick={countSalesLists} disabled={salesCleanup.kind === "counting" || salesCleanup.kind === "busy"}
                  className="shrink-0 rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-surface disabled:opacity-50">
                  {salesCleanup.kind === "counting" ? "Checking…" : salesCleanup.kind === "busy" ? "Deleting…" : "Clean up retired Sales lists"}
                </button>
              )}
            </div>
            {salesCleanup.kind === "done" && (
              <div className="mt-1.5 text-[15px] text-green-600">Deleted {salesCleanup.projects} list{salesCleanup.projects === 1 ? "" : "s"} and {salesCleanup.tasks} task{salesCleanup.tasks === 1 ? "" : "s"}.</div>
            )}
            {salesCleanup.kind === "err" && (
              <div className="mt-1.5 text-[15px] text-red-500">{salesCleanup.msg}</div>
            )}
          </div>
    </div>
  );
}
