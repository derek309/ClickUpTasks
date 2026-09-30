"use client";
// Settings, Integrations: how much client communication has reached
// GoHighLevel, the record of every client conversation. Fed by
// /api/ghl/confirm-status; the same rule as the "Not in GoHighLevel" flag on
// a message.
import { useEffect, useState } from "react";
import { userById } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";

export type GhlRecordStatus = {
  since: string;
  missing: number;
  inbound: number;
  byTeammate: { memberId: string | null; count: number }[];
  unconfirmable: { contactId: string; clientId: string; name: string; count: number }[];
  tokens: { locationId: string; name: string; ok: boolean; status: number }[];
};

export function GhlRecordView({ data, onCheck, checking, checkMsg }: { data: GhlRecordStatus | null; onCheck?: () => void; checking?: boolean; checkMsg?: string }) {
  const rejected = data?.tokens.filter((t) => !t.ok) ?? [];
  return (
    <div className="mb-2 rounded-lg border bg-background px-3 py-2.5">
      <p className="text-[13px] text-muted">
        Every email, text and call should land in GoHighLevel. The app checks every 15 minutes and flags anything
        still missing after an hour. Counts start {data ? new Date(data.since).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "on launch day"}.
      </p>
      {!data ? (
        <div className="mt-2 text-[15px] text-muted">Checking…</div>
      ) : (
        <div className="mt-2 space-y-2 text-[15px]">
          {rejected.map((t) => (
            <div key={t.locationId} className="rounded-md bg-danger-soft px-2.5 py-1.5 text-danger">
              <b>{t.name}</b>: GoHighLevel {t.status === 401 ? "rejected the token" : "did not answer"}. Nothing from this sub account can be
              pulled or confirmed until a new Private Integration token is connected above.
            </div>
          ))}
          <div>
            <span className={`font-semibold ${data.missing ? "text-danger" : "text-foreground"}`}>{data.missing}</span>{" "}
            {data.missing === 1 ? "message is" : "messages are"} not in GoHighLevel
            {data.missing > 0 && <span className="text-muted"> ({data.inbound} from clients, {data.missing - data.inbound} from the team)</span>}
          </div>
          {data.byTeammate.length > 0 && (
            <ul className="space-y-0.5 pl-1">
              {data.byTeammate.map((t) => (
                <li key={t.memberId ?? "none"} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{t.memberId ? (userById(t.memberId)?.name ?? "Unknown teammate") : "Sent by the app"}</span>
                  <span className="shrink-0 text-muted">{t.count} sent</span>
                </li>
              ))}
            </ul>
          )}
          {data.byTeammate.length > 0 && (
            <p className="text-[13px] text-muted">A teammate listed here most likely has not connected Gmail sync in their GoHighLevel profile.</p>
          )}
          {data.unconfirmable.length > 0 && (
            <div>
              <div className="font-medium">Cannot be confirmed</div>
              <p className="text-[13px] text-muted">These contacts have no GoHighLevel contact, so there is nothing to check against. Save them in GoHighLevel first.</p>
              <ul className="mt-1 space-y-0.5 pl-1">
                {data.unconfirmable.map((u) => (
                  <li key={u.contactId} className="flex items-baseline justify-between gap-3">
                    <a href={`/?client=${encodeURIComponent(u.clientId)}`} className="min-w-0 truncate text-accent hover:underline">{u.name}</a>
                    <span className="shrink-0 text-muted">{u.count} {u.count === 1 ? "message" : "messages"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {onCheck && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={onCheck} disabled={checking}
            className="shrink-0 rounded-md border px-2.5 py-1 text-[15px] font-medium hover:bg-surface disabled:opacity-50">
            {checking ? "Checking GoHighLevel…" : "Check now"}
          </button>
          {checkMsg && !checking && <span className="text-[13px] text-muted">{checkMsg}</span>}
        </div>
      )}
    </div>
  );
}

export function GhlRecordPanel() {
  const [data, setData] = useState<GhlRecordStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState("");
  const load = () => authedFetch("/api/ghl/confirm-status").then((r) => r.json()).then((j) => { if (!j.error) setData(j); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const check = async () => {
    setChecking(true);
    try {
      const res = await authedFetch("/api/ghl/pull-messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 2 }) });
      const j = await res.json().catch(() => ({}));
      setCheckMsg(res.ok ? `Checked ${j.contacts ?? 0} contacts: ${j.stamped ?? 0} confirmed, ${j.inserted ?? 0} new from GoHighLevel.` : String(j.error ?? res.status));
      await load();
    } finally {
      setChecking(false);
    }
  };
  return <GhlRecordView data={data} onCheck={check} checking={checking} checkMsg={checkMsg} />;
}
