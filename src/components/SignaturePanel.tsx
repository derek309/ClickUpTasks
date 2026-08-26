"use client";

// Self-service per-user email signature — reachable by any signed-in user,
// same footing as NotificationPrefsPanel ("per-person setting, not team
// management").
//
// Rich text, authored in the same RichTextEditor the email composer uses, so
// bold and links carry through to the sent email. Stored as HTML and appended
// server-side (src/lib/emailSignature.ts) rather than injected into the
// composer, so it lands on every client email including scheduled and
// AI-drafted sends. It is deliberately NOT shown inside the composer — the
// editor here is WYSIWYG, so it doubles as the preview.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { htmlToText, looksLikeHtml, plainTextToHtml } from "@/lib/data";
import { RichTextEditor } from "./cockpit/RichTextEditor";

const MAX_LEN = 4000;

export default function SignaturePanel() {
  const [signature, setSignature] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  // RichTextEditor reads `value` at mount only, so a load (or a Clear) has to
  // remount it via a changing key — same idiom as the email composers.
  const [editorNonce, setEditorNonce] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await authedFetch("/api/signature");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load signature");
        // Signatures saved before this became rich text are plain text.
        const raw = (json.signature ?? "") as string;
        const html = raw.trim() && !looksLikeHtml(raw) ? plainTextToHtml(raw) : raw;
        setSignature(html);
        setSaved(html);
        setEditorNonce((n) => n + 1);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load signature");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // TipTap's empty document is "<p></p>", which .trim() alone won't catch —
  // same reasoning as hasComposedBody in the composers.
  const isEmpty = (html: string) => !htmlToText(html).trim();
  const dirty = signature !== saved;

  async function save() {
    const toSave = isEmpty(signature) ? "" : signature;
    if (toSave.length > MAX_LEN) { setError(`Signature is too long (max ${MAX_LEN} characters).`); return; }
    setSaving(true);
    try {
      const res = await authedFetch("/api/signature", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signature: toSave }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setSignature(toSave);
      setSaved(toSave);
      setError(null);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function clear() {
    setSignature("");
    setEditorNonce((n) => n + 1);
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
          <div className="max-w-[560px]">
            <RichTextEditor key={`signature-${editorNonce}`} value={signature} onChange={setSignature} placeholder="Derek Fox, ClickUpLocal…" />
          </div>
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
            {!isEmpty(signature) && !dirty && !justSaved && (
              <button onClick={clear} className="text-[13px] font-medium text-muted hover:text-danger">Clear</button>
            )}
          </div>

          {error && <div className="mt-3 text-[13px] text-danger">{error}</div>}
        </>
      )}
    </div>
  );
}
