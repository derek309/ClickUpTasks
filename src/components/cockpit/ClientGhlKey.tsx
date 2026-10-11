"use client";
// A client's own GoHighLevel key, for their website's "Connect GoHighLevel"
// (Brain Box). Admins only, under SaaS account on a task. Saved apart from
// the team's own keys, checked against GoHighLevel first, never shown again
// (api/ghl/client-key, 2026-10-11).
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { locationFromSaasUrl } from "@/lib/saasUrl";

export function ClientGhlKey({ clientId, saasUrl, pushToast }: { clientId: string; saasUrl: string; pushToast: (t: string) => void }) {
  const location = locationFromSaasUrl(saasUrl);
  const [state, setState] = useState<{ connected: boolean; stale: boolean; shared: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!location) return;
    let live = true;
    void authedFetch(`/api/ghl/client-key?client_id=${encodeURIComponent(clientId)}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setState(j); }).catch(() => {});
    return () => { live = false; };
  }, [clientId, location]);
  if (!location) return null;
  const save = async () => {
    if (!key.trim()) return;
    setBusy(true);
    const r = await authedFetch("/api/ghl/client-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, token: key.trim() }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (r?.ok) { setState({ connected: true, stale: false, shared: false }); setEditing(false); setKey(""); pushToast("GoHighLevel key saved for their website"); }
    else pushToast(j?.error ?? "Couldn't save the key");
  };
  const remove = async () => {
    const r = await authedFetch(`/api/ghl/client-key?client_id=${encodeURIComponent(clientId)}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) { setState({ connected: false, stale: false, shared: false }); pushToast("Key removed"); }
  };
  return (
    <div className="flex items-center gap-2 text-[16px]">
      <span className="w-28 shrink-0 text-muted" title="Their own sub account's key, for their website's Connect GoHighLevel">Website key</span>
      {state?.shared ? (
        <span className="text-muted" title="The SaaS link points at Agency or Directory">not their own account</span>
      ) : editing ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <input autoFocus type="password" value={key} onChange={(e) => setKey(e.target.value)} disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }}
            placeholder="Private Integration key" aria-label="GoHighLevel key"
            className="min-w-0 flex-1 rounded-md border bg-surface px-2 py-1 text-[16px] outline-none focus:border-accent" />
          <button onClick={() => void save()} disabled={busy || !key.trim()} className="shrink-0 font-semibold text-accent disabled:opacity-50">{busy ? "Checking…" : "Save"}</button>
        </span>
      ) : state?.connected ? (
        <span className="flex items-center gap-2"><span className="font-medium text-success">✓ Connected</span>
          <button onClick={() => setEditing(true)} className="text-muted hover:text-foreground">Replace</button>
          <button onClick={() => void remove()} className="text-muted hover:text-danger">Remove</button></span>
      ) : (
        <button onClick={() => setEditing(true)} className="text-accent underline underline-offset-[3px]">{state?.stale ? "Add one (SaaS link changed)" : "Add one"}</button>
      )}
    </div>
  );
}
