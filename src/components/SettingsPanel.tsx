"use client";

import { useEffect, useState } from "react";
import { type Client } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";

export default function SettingsPanel({
  clients,
  onSaveClient,
  onSynced,
  onClose,
}: {
  clients: Client[];
  onSaveClient: (c: Client) => void;
  onSynced: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [tokenLocations, setTokenLocations] = useState<string[]>([]);
  const [locs, setLocs] = useState<Record<string, string>>(() => Object.fromEntries(clients.map((c) => [c.id, c.ghlLocationId || ""])));
  const [status, setStatus] = useState<Record<string, { kind: "idle" | "busy" | "ok" | "err"; msg?: string }>>({});
  const [tokens, setTokens] = useState<Record<string, string>>({});
  // Once a sub-account is connected, collapse the token form to a single
  // Sync button — showing both a live token field and Connect+Sync side by
  // side for an already-connected account was the confusing part.
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/ghl/status").then((r) => r.json()).then((j) => { setConfigured(!!j.configured); setTokenLocations(j.locations ?? []); }).catch(() => setConfigured(false));
  }, []);

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
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-[16px] font-semibold">Settings · Integrations</h2>
            <p className="text-[13px] text-muted">Connect your GoHighLevel sub-accounts and pull their contacts.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background">✕</button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
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
        </div>
      </div>
    </>
  );
}
