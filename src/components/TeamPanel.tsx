"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { users, type Me } from "@/lib/data";

type Profile = { id: string; email: string; name: string; role: "admin" | "va"; member_id: string | null; color: string };

export default function TeamPanel({ me, onClose }: { me: Me; onClose: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function authedFetch(init?: RequestInit) {
    const { data } = await supabase.auth.getSession();
    return fetch("/api/team", { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch();
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load team");
      setProfiles(json.profiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    setSaving(id);
    setProfiles((ps) => ps.map((p) => (p.id === id ? { ...p, ...(body.role ? { role: body.role as Profile["role"] } : {}), ...(body.memberId !== undefined ? { member_id: (body.memberId as string) || null } : {}) } : p)));
    try {
      const res = await authedFetch({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      load();
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-[16px] font-semibold">Team</h2>
            <p className="text-[15px] text-muted">Manage who&apos;s an admin vs a VA. VAs sign up themselves, then you set their access here.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background">✕</button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {loading && <div className="py-8 text-center text-[15px] text-muted">Loading team…</div>}
          {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-600">{error}</div>}
          {!loading && profiles.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b py-2.5 last:border-0">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white" style={{ background: p.color }}>{initials(p.name || p.email)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{p.name || p.email}{p.id === me.id && <span className="ml-1 text-[15px] text-muted">(you)</span>}</div>
                <div className="truncate text-[15px] text-muted">{p.email}</div>
              </div>

              <select value={p.member_id ?? ""} disabled={saving === p.id} onChange={(e) => patch(p.id, { memberId: e.target.value })} className="rounded-md border bg-background px-2 py-1 text-[15px] outline-none" title="Roster identity for task assignment">
                <option value="">— roster —</option>
                {users.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
              </select>

              <div className="inline-flex overflow-hidden rounded-md border">
                {(["admin", "va"] as const).map((r) => (
                  <button key={r} disabled={saving === p.id || (p.id === me.id && r === "va")} onClick={() => patch(p.id, { role: r })}
                    className={`px-2.5 py-1 text-[15px] font-medium capitalize ${p.role === r ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:bg-background"} disabled:opacity-40`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!loading && !error && profiles.length === 0 && <div className="py-8 text-center text-[15px] text-muted">No team members yet.</div>}
        </div>
      </div>
    </>
  );
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
