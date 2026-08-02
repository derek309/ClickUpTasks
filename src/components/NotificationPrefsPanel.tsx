"use client";

// Self-service per-user email notification preferences — reachable by any
// signed-in user (not admin-gated), same footing as ApiTokensPanel's "per-
// person setting, not team management" tab. Only controls the best-effort
// EMAIL companion to a notification; the in-app bell always fires regardless
// of these toggles.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { Toggle } from "./cockpit/ui";

type Prefs = { emailNotifyActivity: boolean; emailNotifyMessage: boolean; emailNotifyDm: boolean };

const ROWS: { key: keyof Prefs; label: string; help: string }[] = [
  { key: "emailNotifyActivity", label: "Task activity", help: "Assigned to you, status moves, due-date changes, checklist completions." },
  { key: "emailNotifyMessage", label: "Messages", help: "@mentions and comments addressed to you." },
  { key: "emailNotifyDm", label: "Direct messages", help: "1:1 chat messages." },
];

export default function NotificationPrefsPanel() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<keyof Prefs | null>(null);

  async function load() {
    try {
      const res = await authedFetch("/api/notifications/prefs");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load preferences");
      setPrefs({ emailNotifyActivity: json.emailNotifyActivity, emailNotifyMessage: json.emailNotifyMessage, emailNotifyDm: json.emailNotifyDm });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load preferences");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(key: keyof Prefs) {
    if (!prefs) return;
    const next = !prefs[key];
    setPrefs({ ...prefs, [key]: next }); // optimistic
    setSaving(key);
    try {
      const res = await authedFetch("/api/notifications/prefs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: next }) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
    } catch (e) {
      setPrefs((p) => (p ? { ...p, [key]: !next } : p)); // revert on failure
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="mb-1 text-[15px] font-semibold">Email notifications</div>
      <p className="mb-4 text-[13px] text-muted">
        Turning one of these off only stops the email copy — you&apos;ll still see it in your Inbox in ClickUpTasks.
      </p>
      {loading && <div className="py-8 text-center text-[13px] text-muted">Loading…</div>}
      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-600">{error}</div>}
      {!loading && prefs && (
        <div className="divide-y rounded-lg border">
          {ROWS.map((r) => (
            <div key={r.key} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{r.label}</div>
                <div className="text-[13px] text-muted">{r.help}</div>
              </div>
              <Toggle on={prefs[r.key]} onClick={() => toggle(r.key)} disabled={saving === r.key} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
