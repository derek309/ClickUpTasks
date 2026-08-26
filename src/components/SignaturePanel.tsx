"use client";

// Self-service per-user email signature — reachable by any signed-in user,
// same footing as NotificationPrefsPanel ("per-person setting, not team
// management").
//
// Plain text on purpose: it is escaped and newline-to-<br>'d server-side at
// send time (src/lib/emailSignature.ts), so what you type here is exactly
// what goes out, with no markup to get wrong.
//
// Appended by the server, not by the composer — so it lands on every client
// email including scheduled sends and AI-drafted ones, and it is deliberately
// NOT shown in the composer, which is why the preview below exists.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";

export default function SignaturePanel() {
  const [signature, setSignature] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch("/api/signature");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load signature");
        setSignature(json.signature ?? "");
        setSaved(json.signature ?? "");
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load signature");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty = signature !== saved;

  async function save() {
    setSaving(true);
    try {
      const res = await authedFetch("/api/signature", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signature }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setSaved(signature);
      setError(null);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="mb-1 text-[15px] font-semibold">Email signature</div>
      <p className="mb-3 max-w-[560px] text-[13px] text-muted">
        Added to the bottom of every email you send to a client, from the task messaging column, the Journal, and scheduled sends. It is not added to texts or to internal team notes.
      </p>

      {loading ? (
        <div className="text-[13px] text-muted">Loading…</div>
      ) : (
        <>
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={6}
            maxLength={2000}
            placeholder={"Derek Fox\nClickUpLocal\n(555) 555-5555"}
            className="w-full max-w-[560px] resize-y rounded-lg border bg-background px-3 py-2 text-[15px] outline-none placeholder:text-muted focus:border-accent"
          />
          <div className="mt-2 flex max-w-[560px] items-center gap-2">
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-lg bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {dirty && !saving && <span className="text-[13px] text-muted">Unsaved changes</span>}
            {justSaved && <span className="text-[13px] text-success">Saved</span>}
            {signature.trim() !== "" && !dirty && !justSaved && (
              <button onClick={() => setSignature("")} className="text-[13px] font-medium text-muted hover:text-danger">Clear</button>
            )}
          </div>

          {saved.trim() !== "" && (
            <div className="mt-5 max-w-[560px]">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">How it appears</div>
              <div className="rounded-lg border bg-surface px-3 py-2 text-[15px]">
                <div className="text-muted">…your message</div>
                <div className="mt-3 whitespace-pre-wrap">{saved}</div>
              </div>
            </div>
          )}

          {error && <div className="mt-3 text-[13px] text-danger">{error}</div>}
        </>
      )}
    </div>
  );
}
