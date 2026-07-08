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

  useEffect(() => {
    if (!supabaseReady) { setChecking(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) loadProfile(data.session.user.id, data.session.user.email ?? "");
      else setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) loadProfile(session.user.id, session.user.email ?? "");
      else { setMe(null); setChecking(false); }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile(id: string, email: string) {
    const { data } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
    const roster = users.find((u) => u.id === data?.member_id);
    setMe({
      id: roster?.id ?? id,
      name: roster?.name ?? data?.name ?? email,
      initials: roster?.initials ?? initialsOf(data?.name ?? email),
      color: roster?.color ?? data?.color ?? "#a855f7",
      role: (data?.role as Role) ?? "va",
    });
    setChecking(false);
  }

  if (!supabaseReady)
    return <Centered><div className="text-lg font-semibold">Supabase not configured</div><p className="mt-1 text-sm text-muted">Add your keys to <code>.env.local</code> and restart.</p></Centered>;
  if (checking) return <Centered><div className="text-muted">Loading…</div></Centered>;
  if (!me) return <Login />;
  return <Cockpit me={me} onSignOut={() => supabase.auth.signOut()} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen flex-col items-center justify-center px-6 text-center">{children}</div>;
}

function Login() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password: pw })
        : await supabase.auth.signUp({ email: email.trim(), password: pw, options: { data: { name: name.trim() } } });
    if (res.error) setMsg({ kind: "err", text: res.error.message });
    else if (mode === "up" && !res.data.session) setMsg({ kind: "ok", text: "Account created — check your email to confirm, then sign in." });
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-surface p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-white">CT</span>
          <div className="leading-tight">
            <div className="font-semibold">ClickUpTasks</div>
            <div className="text-[15px] text-muted">GHL Task Cockpit</div>
          </div>
        </div>

        <h1 className="text-[17px] font-semibold">{mode === "in" ? "Sign in" : "Create your account"}</h1>
        <p className="mb-4 text-[15px] text-muted">{mode === "in" ? "Welcome back." : "Set a password to get started."}</p>

        <form onSubmit={submit} className="space-y-2.5">
          {mode === "up" && (
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="w-full rounded-lg border bg-background px-3 py-2 text-[15px] outline-none focus:border-accent" />
          )}
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-lg border bg-background px-3 py-2 text-[15px] outline-none focus:border-accent" />
          <input type="password" required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="w-full rounded-lg border bg-background px-3 py-2 text-[15px] outline-none focus:border-accent" />
          {msg && <div className={`rounded-lg px-3 py-2 text-[15px] ${msg.kind === "err" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>{msg.text}</div>}
          <button disabled={busy} className="w-full rounded-lg bg-accent px-3 py-2 text-[15px] font-medium text-white disabled:opacity-50">
            {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button onClick={() => { setMode(mode === "in" ? "up" : "in"); setMsg(null); }} className="mt-4 w-full text-center text-[15px] text-muted hover:text-foreground">
          {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
