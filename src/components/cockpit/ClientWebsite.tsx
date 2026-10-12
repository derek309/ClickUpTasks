"use client";
// A client's WordPress site, for sending task pictures to its Media Library
// (Derek, 2026-10-12). Admins only, under SaaS account on a task, like the
// GoHighLevel key beside it: the address, a username and an Application
// Password (WordPress: Users, Profile, Application Passwords). Checked by
// signing in, never shown again (api/clients/website).
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";

export function ClientWebsite({ clientId, pushToast }: { clientId: string; pushToast: (t: string) => void }) {
  const [state, setState] = useState<{ connected: boolean; url?: string; user?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ url: "", user: "", password: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void authedFetch(`/api/clients/website?client_id=${encodeURIComponent(clientId)}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setState(j); }).catch(() => {});
    return () => { live = false; };
  }, [clientId]);
  const save = async () => {
    setBusy(true);
    const r = await authedFetch("/api/clients/website", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, ...form }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (r?.ok) { setState({ connected: true, url: j.url, user: j.user }); setEditing(false); setForm({ url: "", user: "", password: "" }); pushToast(`Website connected as ${j.as}`); }
    else pushToast(j?.error ?? "Couldn't connect the website");
  };
  const remove = async () => {
    const r = await authedFetch(`/api/clients/website?client_id=${encodeURIComponent(clientId)}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) { setState({ connected: false }); pushToast("Website removed"); }
  };
  const input = "min-w-0 rounded-md border bg-surface px-2 py-1 text-[16px] outline-none focus:border-accent";
  return (
    <div className="flex items-start gap-2 text-[16px]">
      <span className="w-28 shrink-0 pt-1 text-muted" title="Their WordPress site, so task pictures can go straight to its Media Library. Make an Application Password in WordPress (Users, Profile, Application Passwords) for an Editor or Administrator.">Website</span>
      {editing ? (
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <input autoFocus value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://theirsite.com" aria-label="Website address" className={input} />
          <input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder="WordPress username" aria-label="WordPress username" className={input} />
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Application Password" aria-label="Application Password"
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} className={input} />
          <span className="flex gap-3">
            <button onClick={() => void save()} disabled={busy || !form.url.trim() || !form.user.trim() || !form.password.trim()} className="font-semibold text-accent disabled:opacity-50">{busy ? "Checking…" : "Save"}</button>
            <button onClick={() => setEditing(false)} className="text-muted hover:text-foreground">Cancel</button>
          </span>
        </span>
      ) : state?.connected ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 pt-1">
          <span className="min-w-0 truncate font-medium text-success" title={`${state.url} as ${state.user}`}>✓ {state.url?.replace(/^https?:\/\//, "")}</span>
          <button onClick={() => setEditing(true)} className="text-muted hover:text-foreground">Replace</button>
          <button onClick={() => void remove()} className="text-muted hover:text-danger">Remove</button>
        </span>
      ) : (
        <button onClick={() => setEditing(true)} className="pt-1 text-accent underline underline-offset-[3px]">Add one</button>
      )}
    </div>
  );
}
