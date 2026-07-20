"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabase";
import { users, type Me, type Role } from "@/lib/data";
import Cockpit from "./Cockpit";

function initialsOf(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  // Set when the user arrived via a password-reset email link — Supabase
  // establishes a real session for this (so `me` loads normally), but the
  // intent is "let me set a new password," not "drop me into the app," so
  // this takes priority over rendering Cockpit until they've done that.
  const [recoveryMode, setRecoveryMode] = useState(false);

  async function loadProfile(id: string, email: string) {
    const { data } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
    const roster = users.find((u) => u.id === data?.member_id);
    setMe({
      id: roster?.id ?? id,
      name: roster?.name ?? data?.name ?? email,
      initials: roster?.initials ?? initialsOf(data?.name ?? email),
      color: roster?.color ?? data?.color ?? "#a855f7",
      role: (data?.role as Role) ?? "va",
      canSendMessages: data?.role === "admin" || !!data?.can_send_messages,
    });
    setChecking(false);
  }

  useEffect(() => {
    // Bail synchronously before any session/auth-state work — a direct,
    // unavoidable setState for the "not configured" bootstrap path.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!supabaseReady) { setChecking(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) loadProfile(data.session.user.id, data.session.user.email ?? "");
      else setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((e, session) => {
      if (e === "PASSWORD_RECOVERY") setRecoveryMode(true);
      if (session) loadProfile(session.user.id, session.user.email ?? "");
      else { setMe(null); setChecking(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabaseReady)
    return <Centered><div className="text-lg font-semibold">Supabase not configured</div><p className="mt-1 text-sm text-muted">Add your keys to <code>.env.local</code> and restart.</p></Centered>;
  if (checking) return <Centered><div className="text-muted">Loading…</div></Centered>;
  if (recoveryMode) return <SetNewPassword onDone={() => setRecoveryMode(false)} />;
  if (!me) return <Login />;
  return <Cockpit me={me} onSignOut={() => supabase.auth.signOut()} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen flex-col items-center justify-center px-6 text-center">{children}</div>;
}

// Sign-in only — accounts are created exclusively via an admin's invite
// (Team panel), which sends a Supabase magic-link email to set a password.
// There is intentionally no public self-serve signup here.
function Login() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (res.error) setMsg({ kind: "err", text: res.error.message });
    setBusy(false);
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    // Supabase always returns ok here regardless of whether the email exists
    // (avoids leaking which addresses have accounts) — show the same message
    // either way.
    setMsg(res.error ? { kind: "err", text: res.error.message } : { kind: "ok", text: "If that email has an account, a reset link is on its way." });
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-surface p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-white">CT</span>
          <div className="leading-tight">
            <div className="font-semibold">ClickUpTasks</div>
            <div className="text-[13px] text-muted">GHL Task Cockpit</div>
          </div>
        </div>

        {forgotMode ? (<>
          <h1 className="text-[20px] font-semibold">Reset password</h1>
          <p className="mb-4 text-[13px] text-muted">We&apos;ll email you a link to set a new one.</p>
          <form onSubmit={submitForgot} className="space-y-2.5">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-lg border bg-background px-3 py-2 text-[15px] outline-none focus:border-accent" />
            {msg && <div className={`rounded-lg px-3 py-2 text-[15px] ${msg.kind === "err" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>{msg.text}</div>}
            <button disabled={busy} className="w-full rounded-lg bg-accent px-3 py-2 text-[15px] font-medium text-white disabled:opacity-50">
              {busy ? "…" : "Send reset link"}
            </button>
          </form>
          <button onClick={() => { setForgotMode(false); setMsg(null); }} className="mt-4 w-full text-center text-[13px] text-muted hover:text-foreground">Back to sign in</button>
        </>) : (<>
          <h1 className="text-[20px] font-semibold">Sign in</h1>
          <p className="mb-4 text-[13px] text-muted">Welcome back.</p>

          <form onSubmit={submit} className="space-y-2.5">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-lg border bg-background px-3 py-2 text-[15px] outline-none focus:border-accent" />
            <input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="w-full rounded-lg border bg-background px-3 py-2 text-[15px] outline-none focus:border-accent" />
            {msg && <div className={`rounded-lg px-3 py-2 text-[15px] ${msg.kind === "err" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>{msg.text}</div>}
            <button disabled={busy} className="w-full rounded-lg bg-accent px-3 py-2 text-[15px] font-medium text-white disabled:opacity-50">
              {busy ? "…" : "Sign in"}
            </button>
          </form>
          <button onClick={() => { setForgotMode(true); setMsg(null); }} className="mt-3 w-full text-center text-[13px] text-muted hover:text-foreground">Forgot password?</button>

          <p className="mt-4 text-center text-[13px] text-muted">New teammate? Ask your admin for an invite.</p>
        </>)}
      </div>
    </div>
  );
}

// Landed here via a password-reset email link — Supabase already gave this
// browser a real (recovery) session, so this just needs to collect the new
// password and call updateUser; no email/token juggling on our side.
function SetNewPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setError("Password must be at least 8 characters."); return; }
    setBusy(true);
    setError(null);
    const res = await supabase.auth.updateUser({ password: pw });
    if (res.error) { setError(res.error.message); setBusy(false); return; }
    onDone();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-surface p-7 shadow-sm">
        <h1 className="text-[20px] font-semibold">Set a new password</h1>
        <p className="mb-4 text-[13px] text-muted">Choose a new password for your account.</p>
        <form onSubmit={submit} className="space-y-2.5">
          <input autoFocus type="password" required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8 characters)" className="w-full rounded-lg border bg-background px-3 py-2 text-[15px] outline-none focus:border-accent" />
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-600">{error}</div>}
          <button disabled={busy || pw.length < 8} className="w-full rounded-lg bg-accent px-3 py-2 text-[15px] font-medium text-white disabled:opacity-50">
            {busy ? "…" : "Set password"}
          </button>
        </form>
      </div>
    </div>
  );
}
