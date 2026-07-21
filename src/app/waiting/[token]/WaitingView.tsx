"use client";

// Public, read-only, no login — see supabase/client-share-token.sql and
// src/app/api/waiting/[token]/route.ts. Styled like App.tsx's Login/
// SetNewPassword screens (the only other "outside the main Cockpit shell"
// surfaces in this app) rather than through Cockpit.tsx.
import { useEffect, useState } from "react";
import { formatDue, isOverdue } from "@/lib/data";

type WaitingTask = { id: string; title: string; due: string | null; description: string };

export default function WaitingView({ token }: { token: string }) {
  const [clientName, setClientName] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WaitingTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/waiting/${token}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setError(j.error || "This link isn't valid."); return; }
        setClientName(j.clientName ?? null);
        setTasks(Array.isArray(j.tasks) ? j.tasks : []);
      } catch {
        setError("Couldn't load this page — check your connection and try again.");
      }
    })();
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border bg-surface p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-white">CT</span>
          <div className="leading-tight">
            <div className="font-semibold">ClickUpLocal</div>
            <div className="text-[13px] text-muted">What we&apos;re waiting on you for</div>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-600">{error}</div>
        ) : !tasks ? (
          <div className="py-8 text-center text-[13px] text-muted">Loading…</div>
        ) : (
          <>
            {clientName && <h1 className="mb-4 text-[20px] font-semibold">{clientName}</h1>}
            {tasks.length === 0 ? (
              <div className="py-8 text-center text-[15px] text-muted">Nothing needed from you right now — you&apos;re all caught up. 🎉</div>
            ) : (
              <div className="space-y-3">
                {tasks.map((t) => (
                  <div key={t.id} className="rounded-xl border p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-[15px] font-medium">{t.title}</div>
                      {t.due && (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${isOverdue(t.due) ? "bg-red-50 text-red-600" : "bg-accent-soft text-accent"}`}>
                          {formatDue(t.due)}
                        </span>
                      )}
                    </div>
                    {t.description && <p className="mt-1.5 whitespace-pre-wrap text-[14px] text-muted">{t.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
