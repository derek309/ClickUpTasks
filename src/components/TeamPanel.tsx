"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { type Me } from "@/lib/data";
import { ConfirmModal, type ConfirmSpec } from "./cockpit/modals";
import { I } from "./cockpit/ui";

type Profile = { id: string; email: string; name: string; role: "admin" | "va"; color: string; pending?: boolean; avatar_url?: string | null; can_send_messages?: boolean; send_from_email?: string | null; ghl_user_id?: string | null };

export default function TeamPanel({ me }: { me: Me }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  // Admin-set-password — the resilient path when Supabase's own invite/reset
  // email is stuck (rate-limited, wrong inbox, etc.): needs no email delivery
  // to work at all. passwordFor holds the profile being set; revealed holds
  // the just-set password for a one-time copy (same "show once" idiom as
  // ApiTokensPanel's new-token reveal).
  const [passwordFor, setPasswordFor] = useState<Profile | null>(null);
  const [passwordValue, setPasswordValue] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function authedFetch(path: string, init?: RequestInit) {
    const { data } = await supabase.auth.getSession();
    return fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/team");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load team");
      setProfiles(json.profiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Runs once on mount to populate the roster — standard bootstrap-fetch
    // pattern, same as elsewhere in this app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    setSaving(id);
    setProfiles((ps) => ps.map((p) => (p.id === id ? { ...p, ...(body.role ? { role: body.role as Profile["role"] } : {}), ...(typeof body.can_send_messages === "boolean" ? { can_send_messages: body.can_send_messages } : {}), ...(typeof body.send_from_email === "string" ? { send_from_email: body.send_from_email.trim() || null } : {}), ...(typeof body.ghl_user_id === "string" ? { ghl_user_id: body.ghl_user_id.trim() || null } : {}) } : p)));
    try {
      const res = await authedFetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      load();
    } finally {
      setSaving(null);
    }
  }

  async function uploadAvatar(id: string, file: File) {
    setUploadingId(id);
    setError(null);
    try {
      const form = new FormData();
      form.set("id", id);
      form.set("file", file);
      const res = await authedFetch("/api/team/avatar", { method: "POST", body: form });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      setProfiles((ps) => ps.map((p) => (p.id === id ? { ...p, avatar_url: j.avatar_url } : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingId(null);
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteMsg(null);
    try {
      const res = await authedFetch("/api/team/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim() }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Invite failed");
      setInviteMsg({ kind: "ok", text: `Invite sent to ${j.email}` });
      setInviteEmail("");
      setInviteName("");
      load();
    } catch (e) {
      setInviteMsg({ kind: "err", text: e instanceof Error ? e.message : "Invite failed" });
    } finally {
      setInviting(false);
    }
  }

  function randomPassword() {
    const bytes = crypto.getRandomValues(new Uint8Array(9));
    return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 12);
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordFor || passwordValue.length < 8) return;
    setSettingPassword(true);
    setPasswordError(null);
    try {
      const res = await authedFetch("/api/team/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: passwordFor.id, password: passwordValue }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to set password");
      setRevealed({ name: passwordFor.name || passwordFor.email, password: passwordValue });
      setPasswordFor(null);
      setPasswordValue("");
      load(); // picks up email_confirm flipping "Invite pending" off
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Failed to set password");
    } finally {
      setSettingPassword(false);
    }
  }

  function removeUser(p: Profile) {
    setConfirmDialog({
      title: p.pending ? `Revoke invite for ${p.email}?` : `Remove ${p.name || p.email}?`,
      message: p.pending
        ? "Their invite link will stop working and they'll disappear from the team."
        : "Their account is deleted and they lose access immediately. Tasks assigned to them keep their history.",
      confirmLabel: p.pending ? "Revoke invite" : "Remove",
      onConfirm: async () => {
        setConfirmDialog(null);
        setSaving(p.id);
        try {
          const res = await authedFetch("/api/team", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) });
          if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
          setProfiles((ps) => ps.filter((x) => x.id !== p.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Remove failed");
        } finally {
          setSaving(null);
        }
      },
    });
  }

  return (
    <>
        <form onSubmit={sendInvite} className="flex flex-wrap items-center gap-2 border-b bg-background/40 px-5 py-3">
          <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Name (optional)" className="w-40 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
          <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email" required placeholder="teammate@email.com" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
          <button type="submit" disabled={inviting || !inviteEmail.trim()} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{inviting ? "Sending…" : "Send invite"}</button>
          {inviteMsg && <div className={`w-full text-[15px] ${inviteMsg.kind === "err" ? "text-red-500" : "text-green-600"}`}>{inviteMsg.text}</div>}
        </form>

        <div className="px-5 py-3">
          {loading && <div className="py-8 text-center text-[13px] text-muted">Loading team…</div>}
          {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-600">{error}</div>}
          {!loading && profiles.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b py-2.5 last:border-0">
              <label className="group/avatar relative block h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-full" title="Upload a headshot">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(p.id, f); e.target.value = ""; }} />
                {p.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element -- small fixed-size thumbnail, not worth next/image's setup here.
                  ? <img src={p.avatar_url} alt={p.name || p.email} className="h-8 w-8 rounded-full object-cover" />
                  : <span className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-semibold text-white" style={{ background: p.color }}>{initials(p.name || p.email)}</span>}
                <span className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white transition-opacity ${uploadingId === p.id ? "opacity-100" : "opacity-0 group-hover/avatar:opacity-100"}`}>
                  {uploadingId === p.id ? <span className="text-[11px]">…</span> : <I.pencil className="h-3.5 w-3.5" />}
                </span>
              </label>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{p.name || p.email}{p.id === me.id && <span className="ml-1 text-[13px] text-muted">(you)</span>}{p.pending && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[13px] font-medium text-amber-700">Invite pending</span>}</div>
                <div className="truncate text-[13px] text-muted">{p.email}</div>
                {/* Send-from address for outbound emails. Only meaningful for
                    accounts that can send; the domain must be authenticated in
                    the GHL sub-account or GHL rejects it at send time. */}
                {(p.role === "admin" || !!p.can_send_messages) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted">Sends as</span>
                      <input type="email" defaultValue={p.send_from_email ?? ""} disabled={saving === p.id}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.send_from_email ?? "")) patch(p.id, { send_from_email: v }); }}
                        placeholder="default sender"
                        className="min-w-0 max-w-[200px] flex-1 rounded border bg-background px-1.5 py-0.5 text-[12px] outline-none placeholder:text-muted/70 focus:border-accent disabled:opacity-50" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted" title="Paste this teammate's GoHighLevel user id so email sends as them">GHL user</span>
                      <input defaultValue={p.ghl_user_id ?? ""} disabled={saving === p.id}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.ghl_user_id ?? "")) patch(p.id, { ghl_user_id: v }); }}
                        placeholder="GHL user id"
                        className="min-w-0 max-w-[220px] flex-1 rounded border bg-background px-1.5 py-0.5 text-[12px] outline-none placeholder:text-muted/70 focus:border-accent disabled:opacity-50" />
                    </div>
                  </div>
                )}
              </div>

              {/* Send email/SMS permission. Admins always can (shown locked-on);
                  VAs are off by default and an admin flips this to grant it. */}
              {(() => {
                const canSend = p.role === "admin" || !!p.can_send_messages;
                return (
                  <button
                    disabled={saving === p.id || p.role === "admin"}
                    onClick={() => patch(p.id, { can_send_messages: !p.can_send_messages })}
                    title={p.role === "admin" ? "Admins can always send email & SMS" : canSend ? "Can send email & SMS — click to revoke" : "Can't send email & SMS — click to allow"}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] font-medium disabled:opacity-60 ${canSend ? "border-accent bg-accent-soft text-accent" : "text-muted hover:bg-background"}`}>
                    <I.bolt /> {canSend ? "Can send" : "No send"}
                  </button>
                );
              })()}
              <div className="inline-flex overflow-hidden rounded-md border">
                {(["admin", "va"] as const).map((r) => (
                  <button key={r} disabled={saving === p.id || (p.id === me.id && r === "va")} onClick={() => patch(p.id, { role: r })}
                    className={`px-2.5 py-1 text-[15px] font-medium capitalize ${p.role === r ? "bg-accent-soft text-accent" : "bg-surface text-muted hover:bg-background"} disabled:opacity-40`}>
                    {r}
                  </button>
                ))}
              </div>
              <button onClick={() => { setPasswordFor(p); setPasswordValue(randomPassword()); setPasswordError(null); }} disabled={saving === p.id} title="Set a password directly — works even if their invite/reset email never arrives"
                className="rounded-md border px-2 py-1 text-muted hover:bg-background hover:text-foreground disabled:opacity-40"><I.key /></button>
              {p.id !== me.id && (
                <button onClick={() => removeUser(p)} disabled={saving === p.id} title={p.pending ? "Revoke invite" : "Remove user"}
                  className="rounded-md border px-2 py-1 text-[13px] text-muted hover:border-red-300 hover:text-red-500 disabled:opacity-40">✕</button>
              )}
            </div>
          ))}
          {!loading && !error && profiles.length === 0 && <div className="py-8 text-center text-[13px] text-muted">No team members yet.</div>}
        </div>
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
      {passwordFor && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setPasswordFor(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface p-5 shadow-xl">
            <h3 className="text-[16px] font-semibold">Set password for {passwordFor.name || passwordFor.email}</h3>
            <p className="mt-1 text-[13px] text-muted">They can sign in with this immediately — no email required. You&apos;ll see it once after saving so you can relay it to them.</p>
            <form onSubmit={submitPassword} className="mt-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <input autoFocus value={passwordValue} onChange={(e) => setPasswordValue(e.target.value)} placeholder="Password (min 8 characters)"
                  className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
                <button type="button" onClick={() => setPasswordValue(randomPassword())} className="shrink-0 rounded-md border px-2.5 py-1.5 text-[13px] font-medium hover:bg-background">Generate</button>
              </div>
              {passwordError && <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{passwordError}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setPasswordFor(null)} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
                <button type="submit" disabled={settingPassword || passwordValue.length < 8} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">{settingPassword ? "Saving…" : "Set password"}</button>
              </div>
            </form>
          </div>
        </>
      )}
      {revealed && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setRevealed(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface p-5 shadow-xl">
            <h3 className="text-[16px] font-semibold">Password set for {revealed.name}</h3>
            <p className="mb-2 mt-1 text-[13px] font-medium text-amber-700">Copy this now — you won&apos;t be able to see it again.</p>
            <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-2">
              <code className="min-w-0 flex-1 break-all text-[13px]">{revealed.password}</code>
              <button onClick={() => { navigator.clipboard.writeText(revealed.password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
                className="shrink-0 rounded-md border bg-surface px-2 py-1 text-[13px] font-medium hover:bg-background">{copied ? "Copied" : "Copy"}</button>
            </div>
            <button onClick={() => setRevealed(null)} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white">Done</button>
          </div>
        </>
      )}
    </>
  );
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
