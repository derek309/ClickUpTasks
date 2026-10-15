"use client";

// A client's step's Asked list (Derek and Justin, 2026-10-15, mockup part 1):
// each reminder about it, "Oct 15 · asked · sent", "Oct 17 · due today ·
// waiting for review". Nothing shows until one has gone or waits.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { formatDue, toPacificDate } from "@/lib/data";

export type AskedEntry = { at: string; stage: string; status: "sent" | "review" | "skipped" | "going" | "failed" };
const STATUS_WORDS: Record<AskedEntry["status"], string> = { sent: "sent", review: "waiting for review", skipped: "skipped", going: "approved, going out", failed: "didn't send" };

/** The asked entries for these steps of one client, read once per change. */
export function useAsked(clientId: string | null, stepIds: string[]): Record<string, AskedEntry[]> {
  const [asked, setAsked] = useState<Record<string, AskedEntry[]>>({});
  const key = stepIds.join(",");
  useEffect(() => {
    if (!clientId || !key) return;
    let live = true;
    authedFetch(`/api/reminders/asked?client=${encodeURIComponent(clientId)}&steps=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j?.asked) setAsked(j.asked); }, () => {});
    return () => { live = false; };
  }, [clientId, key]);
  return asked;
}

export function AskedLog({ clientId, stepId, entries }: { clientId: string; stepId: string; entries?: AskedEntry[] }) {
  const fetched = useAsked(entries ? null : clientId, entries ? [] : [stepId]);
  const list = entries ?? fetched[stepId] ?? [];
  if (!list.length) return null;
  return (
    <section aria-label="Asked" className="flex flex-col gap-1 border-t pt-2 text-[16px]">
      <b>Asked</b>
      {list.map((e, i) => (
        <div key={i} className="flex flex-wrap justify-between gap-x-3">
          <span>{formatDue(toPacificDate(e.at))} · {e.stage}</span>
          <span className={e.status === "sent" ? "text-muted" : e.status === "failed" ? "text-danger" : "font-semibold text-highlight"}>{STATUS_WORDS[e.status]}</span>
        </div>
      ))}
    </section>
  );
}
