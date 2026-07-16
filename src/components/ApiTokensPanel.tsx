"use client";

// Self-service personal API tokens — reachable by any signed-in user (not
// admin-gated like TeamPanel), since the Gmail extension is a per-person
// credential, not a team-management concern.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { CLAUDE_REPO_PATH_KEY, getClaudeRepoPath } from "@/lib/claudeLink";
import { ConfirmModal, type ConfirmSpec } from "./cockpit/modals";
import { I } from "./cockpit/ui";

type TokenRow = { id: string; name: string; created_at: string; last_used_at: string | null };

export default function ApiTokensPanel({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmSpec | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState("");
  const [repoSaved, setRepoSaved] = useState(false);

  useEffect(() => { setRepoPath(getClaudeRepoPath()); }, []);

  function saveRepoPath() {
    try { localStorage.setItem(CLAUDE_REPO_PATH_KEY, repoPath.trim()); } catch {}
    setRepoSaved(true);
    setTimeout(() => setRepoSaved(false), 2000);
  }

  async function load() {
    try {
      const res = await authedFetch("/api/tokens");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load tokens");
      setTokens(json.tokens);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await authedFetch("/api/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName.trim() || undefined }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to create token");
      setRevealedToken(j.token);
      setNewName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create token");
    } finally {
      setCreating(false);
    }
  }

  function revoke(t: TokenRow) {
    setConfirmDialog({
      title: `Revoke "${t.name}"?`,
      message: "Anything using this token (like the Chrome extension) will stop working immediately.",
      confirmLabel: "Revoke",
      onConfirm: async () => {
        setConfirmDialog(null);
        setRevoking(t.id);
        try {
          const res = await authedFetch("/api/tokens", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id }) });
          if (!res.ok) { const j = await res.json(); throw new Error(j.error); }
          setTokens((ts) => ts.filter((x) => x.id !== t.id));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Revoke failed");
        } finally {
          setRevoking(null);
        }
      },
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-[16px] font-semibold">API tokens</h2>
            <p className="text-[13px] text-muted">Personal tokens for external tools — like the Gmail Chrome extension — to create tasks as you.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background">✕</button>
        </div>

        {revealedToken ? (
          <div className="px-5 py-4">
            <p className="mb-2 text-[15px] font-medium text-amber-700">Copy this now — you won&apos;t be able to see it again.</p>
            <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-2">
              <code className="min-w-0 flex-1 break-all text-[13px]">{revealedToken}</code>
              <button onClick={() => { navigator.clipboard.writeText(revealedToken).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
                className="shrink-0 rounded-md border bg-surface px-2 py-1 text-[13px] font-medium hover:bg-background">{copied ? "Copied" : "Copy"}</button>
            </div>
            <button onClick={() => setRevealedToken(null)} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white">Done</button>
          </div>
        ) : (
          <form onSubmit={createToken} className="flex items-center gap-2 border-b bg-background/40 px-5 py-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Token name (e.g. Gmail extension)" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
            <button type="submit" disabled={creating} className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40"><I.plus className="mr-1 inline h-3.5 w-3.5" />{creating ? "Creating…" : "New token"}</button>
          </form>
        )}

        <div className="max-h-[50vh] overflow-y-auto px-5 py-3">
          {loading && <div className="py-8 text-center text-[13px] text-muted">Loading tokens…</div>}
          {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[15px] text-red-600">{error}</div>}
          {!loading && tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-3 border-b py-2.5 last:border-0">
              <I.key className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{t.name}</div>
                <div className="truncate text-[13px] text-muted">Created {new Date(t.created_at).toLocaleDateString()}{t.last_used_at ? ` · last used ${new Date(t.last_used_at).toLocaleDateString()}` : " · never used"}</div>
              </div>
              <button onClick={() => revoke(t)} disabled={revoking === t.id} title="Revoke" className="rounded-md border px-2 py-1 text-[13px] text-muted hover:border-red-300 hover:text-red-500 disabled:opacity-40">✕</button>
            </div>
          ))}
          {!loading && !error && tokens.length === 0 && <div className="py-8 text-center text-[13px] text-muted">No tokens yet.</div>}
        </div>

        <div className="border-t bg-background/40 px-5 py-4">
          <div className="mb-2 text-[15px] font-semibold">Work with Claude</div>
          <p className="mb-2 text-[13px] text-muted">The local folder &quot;Work with Claude&quot; opens Claude Code in, on this browser/computer. Set once here — never asks again.</p>
          <div className="flex items-center gap-2">
            <input value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="/path/to/clickuptasks" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
            <button onClick={saveRepoPath} className="shrink-0 rounded-md border bg-surface px-3 py-1.5 text-[15px] font-medium hover:bg-background">{repoSaved ? "Saved" : "Save"}</button>
          </div>
        </div>

        <div className="border-t bg-background/40 px-5 py-4">
          <div className="mb-2 text-[15px] font-semibold">Gmail extension</div>
          <p className="mb-2 text-[13px] text-muted">Create a ClickUpTasks task straight from an email you&apos;re viewing in Gmail.</p>
          <ol className="mb-3 list-decimal space-y-1 pl-4 text-[13px] text-muted">
            <li><a href="/clickuptasks-gmail-extension.zip" download className="font-medium text-accent hover:underline">Download the extension</a> and unzip it.</li>
            <li>In Chrome, go to <code className="rounded bg-surface px-1 py-0.5">chrome://extensions</code> and turn on <b>Developer mode</b> (top right).</li>
            <li>Click <b>Load unpacked</b> and select the unzipped <code className="rounded bg-surface px-1 py-0.5">chrome-extension</code> folder.</li>
            <li>It&apos;ll open a settings page &mdash; create a token above and paste it there.</li>
            <li>Open any email in Gmail and click the extension&apos;s icon in Chrome&apos;s toolbar.</li>
          </ol>
        </div>
      </div>
      {confirmDialog && <ConfirmModal {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </>
  );
}
