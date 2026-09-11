"use client";

// Public, no login: a client reviews a document the team wrote on one of their
// tasks, edits it if they like, and sends their changes or approves it. See
// src/app/api/doc/[token] for the routes and src/lib/taskDocumentServer.ts for
// the rules behind them.
//
// Nothing reaches the server until the client clicks. Their unsent edits live in
// this browser (localStorage, per document version), so closing the tab, a
// dropped connection, or the team posting a newer version never loses them.
// Every string here is client facing: 16px or larger, and no dashes.
import { useCallback, useEffect, useRef, useState } from "react";
import { RichTextEditor } from "@/components/cockpit/RichTextEditor";
import { addDocFiles } from "@/lib/docFileUpload";
import { extOf, formatFileSize } from "@/lib/uploadTypes";

type DocStatus = "draft" | "with_client" | "client_submitted" | "approved";
type DocFile = { id: string; name: string; size: number; kind: string; addedBy: string; fromClient: boolean; createdAt: string };
type DocData = { title: string; clientName: string; body: string; version: number; status: DocStatus; approvedAt: string | null; closed: boolean; files: DocFile[] };
// Shown as a small picture in the list. HEIC and the rest open by name instead,
// since most browsers cannot draw them.
const THUMB_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
type Notice = { tone: "good" | "info" | "warn"; text: string } | null;

const NAVY = "#1b3a5c";
const GREEN = "#15803d";

// Keyed by the end of the token, not the whole thing: enough to keep documents
// apart on one device without keeping a working link in browser storage.
const draftKey = (token: string, version: number) => `doc:${token.slice(-12)}:v${version}`;
function readDraft(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeDraft(key: string, html: string | null) {
  try {
    if (html === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, html);
  } catch { /* private browsing: drafts just are not kept */ }
}
const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

export default function DocReviewView({ token }: { token: string }) {
  const [data, setData] = useState<DocData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "gone" | "error">("loading");
  // The version the editor opened from. Sends and approvals are built on it.
  const [baseVersion, setBaseVersion] = useState(0);
  // The published text that version holds, to tell whether the client has edited.
  const [startHtml, setStartHtml] = useState("");
  const [html, setHtml] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [newer, setNewer] = useState<{ version: number; body: string } | null>(null);
  const [busy, setBusy] = useState<"send" | "approve" | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  // Files the client added since they last sent, so Send my changes can tell the
  // team about them even when the text is untouched.
  const [filesAdded, setFilesAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = html.trim() !== startHtml.trim();
  const locked = !!data && (data.status === "approved" || data.closed);
  const baseRef = useRef(0);
  const dirtyRef = useRef(false);
  useEffect(() => { baseRef.current = baseVersion; }, [baseVersion]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // Open a version in the editor, bringing back edits the client left unsent on
  // this device for that same version.
  const openVersion = useCallback((d: DocData) => {
    const kept = readDraft(draftKey(token, d.version));
    const start = kept && kept.trim() !== d.body.trim() ? kept : d.body;
    setBaseVersion(d.version);
    setStartHtml(d.body);
    setHtml(start);
    setEditorKey((k) => k + 1);
    setNewer(null);
    if (start !== d.body) setNotice({ tone: "info", text: "We kept your unsent edits from last time." });
  }, [token]);

  const load = useCallback(async (initial: boolean) => {
    try {
      const res = await fetch(`/api/doc/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (res.status === 404) { setState("gone"); return; }
      if (!res.ok) { if (initial) setState("error"); return; }
      const d = (await res.json()) as DocData;
      setData(d);
      setState("ready");
      if (initial) openVersion(d);
      else if (d.version > baseRef.current) {
        // The team posted a newer version. Swap it in quietly unless the client
        // is mid edit, in which case ask first.
        if (dirtyRef.current) setNewer({ version: d.version, body: d.body });
        else openVersion(d);
      }
    } catch {
      if (initial) setState("error");
    }
  }, [token, openVersion]);

  // Fetch on open. State is set only after the request resolves; the rule flags
  // any fetch on mount, and this app marks each one the same way (see Cockpit.tsx).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(false); }, 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  // Keep unsent edits on this device as the client types.
  useEffect(() => {
    if (state !== "ready" || locked) return;
    const t = window.setTimeout(() => writeDraft(draftKey(token, baseVersion), dirty ? html : null), 400);
    return () => window.clearTimeout(t);
  }, [html, dirty, baseVersion, token, state, locked]);

  const publish = async (kind: "submit" | "approve") => {
    setBusy(kind === "submit" ? "send" : "approve");
    setConfirmApprove(false);
    try {
      const res = await fetch(`/api/doc/${encodeURIComponent(token)}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html, baseVersion }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 404) { setState("gone"); return; }
      if (res.status === 409) {
        // Their text stays in the editor. They choose whether to load the newer one.
        if (j.current) setNewer(j.current);
        setNotice({ tone: "warn", text: j.error ?? "This document changed while you were editing." });
        return;
      }
      if (res.status === 429) { setNotice({ tone: "warn", text: "Too many tries. Please wait a moment and try again." }); return; }
      if (!res.ok) { setNotice({ tone: "warn", text: j.error ?? "We couldn't save that. Please try again." }); return; }

      writeDraft(draftKey(token, baseVersion), null);
      setFilesAdded(false);
      const version = j.version as number;
      setBaseVersion(version);
      setStartHtml(html);
      setData((d) => d ? {
        ...d, version,
        status: kind === "approve" ? "approved" : "client_submitted",
        approvedAt: kind === "approve" ? new Date().toISOString() : d.approvedAt,
      } : d);
      setNotice(kind === "approve" ? null : { tone: "good", text: "Thanks! We got your changes. You can keep editing and send again anytime." });
    } catch {
      setNotice({ tone: "warn", text: "We couldn't reach the server. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  };

  const approve = () => { if (dirty) setConfirmApprove(true); else void publish("approve"); };
  const loadNewer = () => {
    if (!newer || !data) return;
    if (dirty && !window.confirm("Load the newer version? Your unsent edits will be replaced.")) return;
    writeDraft(draftKey(token, baseVersion), null);
    openVersion({ ...data, version: newer.version, body: newer.body });
    setNotice(null);
  };
  const undoEdits = () => {
    writeDraft(draftKey(token, baseVersion), null);
    setHtml(startHtml);
    setEditorKey((k) => k + 1);
    setNotice(null);
  };

  const filesApi = (method: "POST" | "DELETE") => (payload: Record<string, unknown>) =>
    fetch(`/api/doc/${encodeURIComponent(token)}/files`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

  const addFiles = async (list: FileList | null) => {
    if (!list?.length || adding) return;
    setAdding(true);
    setNotice(null);
    const error = await addDocFiles(Array.from(list), filesApi("POST"), () => { setFilesAdded(true); void load(false); });
    setAdding(false);
    if (error) setNotice({ tone: "warn", text: error });
    else setNotice({ tone: "good", text: "Added. Send your changes when you're ready so the team knows." });
  };

  const removeFile = async (f: DocFile) => {
    if (!window.confirm(`Remove ${f.name}?`)) return;
    const res = await filesApi("DELETE")({ fileId: f.id });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ tone: "warn", text: j.error ?? "We couldn't remove that file. Please try again." }); return; }
    void load(false);
  };

  const noticeTone = { good: "border-[#15803d] bg-[#f0fdf4] text-[#14532d]", info: "border-[#1b3a5c] bg-[#eef4fb] text-[#1b3a5c]", warn: "border-[#b45309] bg-[#fffbeb] text-[#78350f]" };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header style={{ background: NAVY }} className="text-white">
        <div className="mx-auto flex max-w-[760px] flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-5">
          <span className="text-[18px] font-bold tracking-wide">ClickUpLocal</span>
          {data && <span className="text-[16px] text-white/85">Prepared for {data.clientName}</span>}
        </div>
      </header>

      <main className={`mx-auto max-w-[760px] px-5 pt-7 ${state === "ready" && !locked ? "pb-44" : "pb-16"}`}>
        {state === "loading" && <p className="text-[18px] text-muted">Loading your document…</p>}

        {state === "error" && (
          <div className="rounded-2xl border bg-surface p-6">
            <p className="text-[20px] font-semibold">We couldn&apos;t load this document.</p>
            <p className="mt-1 text-[17px] text-muted">Check your connection and try again.</p>
            <button onClick={() => { setState("loading"); void load(true); }}
              className="mt-4 min-h-[48px] rounded-xl px-6 text-[17px] font-semibold text-white" style={{ background: NAVY }}>Try again</button>
          </div>
        )}

        {state === "gone" && (
          <div className="rounded-2xl border bg-surface p-6">
            <p className="text-[22px] font-semibold">This link is no longer active.</p>
            <p className="mt-2 text-[17px] text-muted">Ask your ClickUpLocal contact for a new one.</p>
          </div>
        )}

        {state === "ready" && data && (
          <>
            <h1 className="text-[30px] font-bold leading-tight">{data.title}</h1>
            {!locked && <p className="mt-2 text-[18px] text-muted">Edit anything you like and send your changes, or approve it as is.</p>}

            {data.status === "approved" && (
              <div className="mt-5 flex items-start gap-4 rounded-2xl border-2 p-5" style={{ borderColor: GREEN, background: "#f0fdf4" }}>
                <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[26px] text-white" style={{ background: GREEN }}>✓</span>
                <div>
                  <p className="text-[24px] font-bold" style={{ color: "#14532d" }}>Approved. Thank you!</p>
                  {data.approvedAt && <p className="mt-0.5 text-[17px]" style={{ color: "#166534" }}>Approved on {longDate(data.approvedAt)}</p>}
                </div>
              </div>
            )}
            {data.closed && data.status !== "approved" && (
              <div className="mt-5 rounded-2xl border bg-surface p-5">
                <p className="text-[20px] font-semibold">This document is closed.</p>
                <p className="mt-1 text-[17px] text-muted">It can&apos;t be changed anymore.</p>
              </div>
            )}

            {notice && (
              <div className={`mt-5 rounded-xl border-l-4 px-4 py-3 text-[17px] ${noticeTone[notice.tone]}`}>{notice.text}</div>
            )}
            {newer && !locked && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: NAVY, background: "#eef4fb" }}>
                <span className="text-[17px]" style={{ color: NAVY }}>The team posted a newer version.</span>
                <button onClick={loadNewer} className="min-h-[44px] rounded-lg px-4 text-[16px] font-semibold text-white" style={{ background: NAVY }}>Load it</button>
              </div>
            )}

            <article className="mt-6 rounded-2xl border bg-surface p-5 shadow-sm sm:p-8">
              <RichTextEditor key={editorKey} value={html} onChange={setHtml} variant="doc" editable={!locked}
                placeholder="This document is empty." />
            </article>

            {(data.files.length > 0 || !locked) && (
              <section
                onDragOver={(e) => { if (!locked && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
                onDragLeave={() => setDropping(false)}
                onDrop={(e) => { if (locked) return; e.preventDefault(); setDropping(false); void addFiles(e.dataTransfer.files); }}
                className={`mt-6 rounded-2xl border-2 bg-surface p-5 sm:p-8 ${dropping ? "border-dashed" : "border-transparent shadow-sm"}`}
                style={dropping ? { borderColor: NAVY } : undefined}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-[22px] font-bold">Files</h2>
                  {!locked && (
                    <>
                      <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
                      <button onClick={() => fileInput.current?.click()} disabled={adding}
                        className="min-h-[48px] rounded-xl border-2 px-5 text-[17px] font-semibold disabled:opacity-50" style={{ borderColor: NAVY, color: NAVY }}>
                        {adding ? "Adding…" : "Add files"}
                      </button>
                    </>
                  )}
                </div>
                {!locked && <p className="mt-1 text-[16px] text-muted">Photos, PDFs, documents, spreadsheets, slides or videos, up to 25 MB each. You can also drop them here.</p>}
                {data.files.length === 0 ? (
                  <p className="mt-4 text-[17px] text-muted">No files yet.</p>
                ) : (
                  <ul className="mt-4 divide-y">
                    {data.files.map((f) => {
                      const href = `/api/doc/${encodeURIComponent(token)}/files/${f.id}`;
                      return (
                        <li key={f.id} className="flex flex-wrap items-center gap-4 py-3">
                          {THUMB_EXT.has(extOf(f.name)) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={href} alt="" className="h-16 w-16 shrink-0 rounded-lg border object-cover" />
                          ) : (
                            <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border text-[16px] font-bold uppercase text-muted">{extOf(f.name)}</span>
                          )}
                          <div className="min-w-0 flex-1">
                            <a href={href} target="_blank" rel="noopener noreferrer" className="block break-words text-[17px] font-semibold underline underline-offset-4" style={{ color: NAVY }}>{f.name}</a>
                            <p className="text-[16px] text-muted">{formatFileSize(f.size)} · Added by {f.fromClient ? "you" : f.addedBy}</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <a href={`${href}?download=1`} className="min-h-[44px] content-center text-[16px] font-medium underline underline-offset-4" style={{ color: NAVY }}>Download</a>
                            {f.fromClient && !locked && (
                              <button onClick={() => void removeFile(f)} className="min-h-[44px] text-[16px] font-medium text-muted underline underline-offset-4">Remove</button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {state === "ready" && data && !locked && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-surface/95 backdrop-blur" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-3 px-5 pt-3">
            {dirty && (
              <button onClick={undoEdits} className="min-h-[48px] px-1 text-[16px] font-medium text-muted underline underline-offset-4">Undo my edits</button>
            )}
            <div className="ml-auto flex w-full gap-3 sm:w-auto">
              <button onClick={() => void publish("submit")} disabled={!(dirty || filesAdded) || busy !== null}
                className="min-h-[52px] flex-1 rounded-xl border-2 px-5 text-[17px] font-semibold transition disabled:opacity-40 sm:flex-none"
                style={{ borderColor: NAVY, color: NAVY }}>
                {busy === "send" ? "Sending…" : "Send my changes"}
              </button>
              <button onClick={approve} disabled={busy !== null}
                className="min-h-[52px] flex-1 rounded-xl px-6 text-[17px] font-bold text-white transition disabled:opacity-60 sm:flex-none"
                style={{ background: GREEN }}>
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmApprove && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setConfirmApprove(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-[460px] rounded-2xl bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[22px] font-bold">Approve with your edits?</p>
            <p className="mt-2 text-[17px] text-muted">Your changes will be saved as the approved version.</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row-reverse">
              <button onClick={() => void publish("approve")} className="min-h-[52px] flex-1 rounded-xl px-5 text-[17px] font-bold text-white" style={{ background: GREEN }}>Approve with my edits</button>
              <button onClick={() => setConfirmApprove(false)} className="min-h-[52px] flex-1 rounded-xl border-2 px-5 text-[17px] font-semibold" style={{ borderColor: NAVY, color: NAVY }}>Keep editing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
