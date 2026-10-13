"use client";

// Your own Granola (Derek, 2026-10-12: "per person keys"). Each teammate
// pastes their personal Granola key once; their meetings then come into the
// client's Journal and onto Transcript steps from whatever folder they keep
// them in. Per person, so on the same footing as Email signature.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { I } from "./cockpit/ui";
import { SettingsCard, StatusWord, BTN, BTN_PRIMARY, INPUT } from "./settings/ui";

type Status = { connected: boolean; since: string | null; webhook: boolean; team?: { name: string; since: string }[] };

export default function GranolaPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "sync" | "off" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchStatus = async (): Promise<Status> => {
    const res = await authedFetch("/api/granola/my-key").catch(() => null);
    return res?.ok ? await res.json() : { connected: false, since: null, webhook: false };
  };
  const load = async () => setStatus(await fetchStatus());
  useEffect(() => {
    let live = true;
    fetchStatus().then((s) => { if (live) setStatus(s); });
    return () => { live = false; };
  }, []);

  const save = async () => {
    setBusy("save"); setMsg(null);
    const res = await authedFetch("/api/granola/my-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) { setMsg({ ok: false, text: j?.error ?? "That didn't work." }); return; }
    setKey("");
    setMsg({ ok: true, text: j?.note ?? "Connected. Your meetings come in by themselves from now on. Click Sync my meetings to bring in the last week." });
    await load();
  };
  const sync = async () => {
    setBusy("sync"); setMsg(null);
    const res = await authedFetch("/api/granola/sync", { method: "POST" }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setBusy(null);
    setMsg(res?.ok
      ? { ok: true, text: `Checked ${j.checked} meetings from the last week: ${j.created} added to a client, ${j.unmatched} with nobody we know, ${j.skipped} already in.` }
      : { ok: false, text: j?.error ?? "Sync failed." });
  };
  const disconnect = async () => {
    setBusy("off"); setMsg(null);
    await authedFetch("/api/granola/my-key", { method: "DELETE" }).catch(() => null);
    setBusy(null);
    setMsg({ ok: true, text: "Disconnected. Meetings already brought in stay where they are." });
    await load();
  };

  return (
    <div className="space-y-4 text-[16px]">
      <SettingsCard title="Your Granola" icon={<I.calendar className="h-4 w-4" />} tone="sky"
        status={status === null ? undefined : <StatusWord ok={status.connected}>{status.connected ? `Connected${status.since ? ` since ${new Date(status.since).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}` : "Not connected"}</StatusWord>}
        hint="Your client meetings come in by themselves: the notes go on the client's Journal, the transcript onto a task's Transcript step. Any folder works.">
      {status === null ? <div className="text-muted">Checking…</div>
        : status.connected ? (
          <div>
            {!status.webhook && <div className="mb-3 text-muted">New meetings come in when you click Sync, not by themselves yet.</div>}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void sync()} disabled={busy !== null} className={BTN_PRIMARY}>{busy === "sync" ? "Syncing…" : "Sync my meetings"}</button>
              <button onClick={() => void disconnect()} disabled={busy !== null} className={BTN}>{busy === "off" ? "Disconnecting…" : "Disconnect"}</button>
            </div>
          </div>
        ) : (
          <div>
            <ol className="mb-3 list-decimal space-y-1 pl-5">
              <li>In Granola, open <b>Settings</b>, then <b>Connectors</b>, then <b>Personal API keys</b>.</li>
              <li>Click <b>Create new key</b>, name it ClickUpTasks, and copy it.</li>
              <li>Paste it here and click Connect.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              {/* Masked text, not a password field: a password field brings up the
                  browser's password manager over the panel. */}
              <input type="text" name="granola-api-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Your Granola key"
                autoComplete="off" autoCorrect="off" spellCheck={false} data-1p-ignore data-lpignore="true"
                style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
                onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) void save(); }}
                className={`${INPUT} flex-1`} />
              <button onClick={() => void save()} disabled={!key.trim() || busy !== null} className={BTN_PRIMARY}>{busy === "save" ? "Checking…" : "Connect"}</button>
            </div>
          </div>
        )}
      {msg && <div className={`mt-3 ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-danger"}`}>{msg.text}</div>}
      </SettingsCard>
      {status?.team && (
        <SettingsCard title="Who is connected" icon={<I.user className="h-4 w-4" />} tone="indigo">
          {status.team.length
            ? <ul className="space-y-0.5">{status.team.map((t) => <li key={t.name + t.since}>{t.name} <span className="text-muted">since {new Date(t.since).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></li>)}</ul>
            : <div className="text-muted">Nobody yet.</div>}
        </SettingsCard>
      )}
    </div>
  );
}
