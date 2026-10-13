"use client";

// Your own Granola (Derek, 2026-10-12: "per person keys"). Each teammate
// pastes their personal Granola key once; their meetings then come into the
// client's Journal and onto Transcript steps from whatever folder they keep
// them in. Per person, so on the same footing as Email signature.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";

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
    <div className="max-w-[620px] px-5 py-4 text-[16px]">
      <div className="mb-1 text-[17px] font-semibold">Granola</div>
      <p className="mb-4 text-muted">
        Connect your own Granola and your client meetings come in by themselves: the notes go on the client&apos;s Journal, and the transcript lands on a task&apos;s Transcript step. Any folder works.
      </p>
      {status === null ? <div className="text-muted">Checking…</div>
        : status.connected ? (
          <div className="rounded-[5px] border bg-background px-4 py-3">
            <div className="font-semibold text-green-700">● Connected{status.since ? ` since ${new Date(status.since).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</div>
            {!status.webhook && <div className="mt-1 text-muted">New meetings come in when you click Sync, not by themselves yet.</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => void sync()} disabled={busy !== null} className="rounded-[5px] bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50">{busy === "sync" ? "Syncing…" : "Sync my meetings"}</button>
              <button onClick={() => void disconnect()} disabled={busy !== null} className="rounded-[5px] border px-3 py-1.5 font-medium hover:bg-surface disabled:opacity-50">{busy === "off" ? "Disconnecting…" : "Disconnect"}</button>
            </div>
          </div>
        ) : (
          <div className="rounded-[5px] border bg-background px-4 py-3">
            <ol className="mb-3 list-decimal space-y-1 pl-5">
              <li>In Granola, open <b>Settings</b>, then <b>Connectors</b>, then <b>Personal API keys</b>.</li>
              <li>Click <b>Create new key</b>, name it ClickUpTasks, and copy it.</li>
              <li>Paste it here and click Connect.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Your Granola key" autoComplete="off"
                onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) void save(); }}
                className="h-10 min-w-0 flex-1 rounded-[5px] border bg-surface px-3 outline-none focus:border-accent" />
              <button onClick={() => void save()} disabled={!key.trim() || busy !== null} className="rounded-[5px] bg-accent px-4 font-medium text-white disabled:opacity-40">{busy === "save" ? "Checking…" : "Connect"}</button>
            </div>
          </div>
        )}
      {msg && <div className={`mt-2 ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</div>}
      {status?.team && (
        <div className="mt-6">
          <div className="mb-1 font-semibold">Who is connected</div>
          {status.team.length
            ? <ul className="space-y-0.5">{status.team.map((t) => <li key={t.name + t.since}>{t.name} <span className="text-muted">since {new Date(t.since).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></li>)}</ul>
            : <div className="text-muted">Nobody yet.</div>}
        </div>
      )}
    </div>
  );
}
