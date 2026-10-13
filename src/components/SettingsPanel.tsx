"use client";

import { useEffect, useState } from "react";
import { type Client } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";
import { GhlRecordPanel } from "./GhlRecordPanel";
import { I } from "./cockpit/ui";
import { SettingsCard, StatusWord, BTN, BTN_PRIMARY, INPUT, ROW } from "./settings/ui";

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
      setGranolaStatus({ kind: "ok", msg: `Registered for ${j.scopes?.includes("workspace") ? "the whole team (workspace key)" : "your own notes only (personal key)"}. Signing secret (copy now, shown once): ${j.signingSecret}` });
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

  const note = (kind: string, msg?: string) => msg ? <div className={`mt-2 break-words text-[16px] ${kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-danger"}`}>{msg}</div> : null;
  return (
    <div className="space-y-4">
      <SettingsCard title="GoHighLevel" icon={<I.bolt className="h-4 w-4" />} tone="amber"
        status={configured === null ? <span className="text-[16px] text-muted">Checking…</span> : <StatusWord ok={configured}>{configured ? "Token connected" : "Token not set"}</StatusWord>}
        hint={configured === false ? <>In each sub account: <b>Settings, Private Integrations, Create</b>, turn on the <b>Contacts</b> (and Tasks) scopes and copy the <code>pit-</code> token. Paste the <b>Location ID</b> and the token below, click <b>Connect</b>, then <b>Sync</b>. Tokens are kept on the server, never in the browser.</> : undefined}>
        <div className="space-y-2">
          {clients.map((c) => {
            const st = status[c.id];
            const loc = (locs[c.id] || "").trim();
            const connected = !!loc && tokenLocations.includes(loc);
            // Not yet connected accounts always show the form (nothing to
            // collapse to); connected ones start collapsed and only show it
            // again if you ask to change the token.
            const showForm = !connected || editing[c.id];
            return (
              <div key={c.id} className={ROW}>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="truncate text-[16px] font-semibold">{c.name}</span>
                  <span className="ml-auto"><StatusWord ok={connected}>{connected ? "Connected" : "Not connected"}</StatusWord></span>
                </div>
                {showForm ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input value={locs[c.id] ?? ""} onChange={(e) => setLoc(c.id, e.target.value)} placeholder="Location ID" className={`${INPUT} w-44`} />
                    <input type="password" value={tokens[c.id] ?? ""} onChange={(e) => setTokens((t) => ({ ...t, [c.id]: e.target.value }))} placeholder="pit- token" className={`${INPUT} flex-1`} />
                    <button onClick={() => connect(c)} disabled={st?.kind === "busy"} className={BTN_PRIMARY}>{st?.kind === "busy" ? "Connecting…" : "Connect"}</button>
                    {connected && <button onClick={() => setEditing((e) => ({ ...e, [c.id]: false }))} className={BTN}>Cancel</button>}
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={() => sync(c)} disabled={st?.kind === "busy"} className={BTN_PRIMARY}>{st?.kind === "busy" ? "Syncing…" : "Sync"}</button>
                    <button onClick={() => setEditing((e) => ({ ...e, [c.id]: true }))} className={BTN}>Change token</button>
                  </div>
                )}
                {st && st.kind !== "busy" && note(st.kind, st.msg)}
              </div>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="Granola" icon={<I.calendar className="h-4 w-4" />} tone="sky"
        status={granolaApiKeyConfigured === null ? <span className="text-[16px] text-muted">Checking…</span>
          : <StatusWord ok={!!granolaApiKeyConfigured && !!granolaWebhookConfigured}>{!granolaApiKeyConfigured ? "Team key not set" : granolaWebhookConfigured ? "Connected" : "Webhook not registered"}</StatusWord>}
        hint={<>Meeting notes go on a client&apos;s Journal once a meeting&apos;s attendees match a contact. Each person connects their own Granola in Settings, Granola; Sync here reads everyone&apos;s.{!granolaWebhookConfigured && granolaApiKeyConfigured && " Click Connect once to register the webhook, then add its signing secret as GRANOLA_WEBHOOK_SECRET."}</>}>
        <div className="flex flex-wrap items-center gap-2">
          {granolaApiKeyConfigured && !granolaWebhookConfigured && (
            <button onClick={connectGranola} disabled={granolaStatus.kind === "busy"} className={BTN_PRIMARY}>{granolaStatus.kind === "busy" ? "Connecting…" : "Connect"}</button>
          )}
          <button onClick={syncGranolaNow} disabled={granolaStatus.kind === "busy"} className={BTN}>{granolaStatus.kind === "busy" ? "Syncing…" : "Sync recent meetings"}</button>
          {/* After swapping in a new team key: register a webhook under it;
              its secret replaces GRANOLA_WEBHOOK_SECRET. */}
          {granolaApiKeyConfigured && granolaWebhookConfigured && (
            <button onClick={connectGranola} disabled={granolaStatus.kind === "busy"} title="After changing the team Granola key: register its webhook, then put the new signing secret in GRANOLA_WEBHOOK_SECRET and redeploy" className={BTN}>Reconnect webhook</button>
          )}
        </div>
        {granolaStatus.kind !== "busy" && note(granolaStatus.kind, granolaStatus.msg)}
      </SettingsCard>

      <SettingsCard title="GoHighLevel record" icon={<I.check className="h-4 w-4" />} tone="emerald">
        <GhlRecordPanel />
      </SettingsCard>

      <SettingsCard title="Data cleanup" icon={<I.repeat className="h-4 w-4" />} tone="slate"
        hint={<>Messages that arrived before conversations were linked to tasks have no thread to follow, so a reply to one lands on a general &quot;Reply to&quot; task instead of the task it belongs to. This asks GoHighLevel which conversation each old message came from. Safe to run more than once: anything already linked is skipped.</>}>
        <button onClick={backfillConversations} disabled={backfill.kind === "busy"} className={BTN}>
          {backfill.kind === "busy" ? "Linking…" : backfill.remaining ? "Link the next 10 clients" : "Link old conversations"}
        </button>
        {backfill.kind !== "busy" && note(backfill.kind, backfill.msg)}
      </SettingsCard>
    </div>
  );
}
