"use client";

// Public, no login: a client reviews a document the team wrote on one of their
// tasks, edits it if they like, and sends their changes or approves it. See
// src/app/api/doc/[token] for the routes and src/lib/taskDocumentServer.ts for
// the rules behind them.
//
// The same link can open an image review or a web page review (Derek,
// 2026-09-12): the client clicks a spot to drop a numbered pin, writes a comment
// or adds a file there, then asks for changes or approves. On a page they can also
// switch to Edit text and change the wording right on the page; only their words
// are sent, and the server builds the new page from the one they saw. The page is
// only ever shown in a sandboxed frame (PageReviewFrame). Earlier versions stay a
// click away with their pins.
//
// Nothing reaches the server until the client clicks. Their unsent edits live in
// this browser (localStorage, per document version or page file), so closing the
// tab, a dropped connection, or the team posting a newer version never loses them.
// Every string here is client facing: 16px or larger, and no dashes.
import { useCallback, useEffect, useRef, useState } from "react";
import { RichTextEditor } from "@/components/cockpit/RichTextEditor";
import { PageReviewFrame, deviceForWidth, type PageDevice } from "@/components/cockpit/PageReviewFrame";
import { addDocFiles, uploadSharedFile } from "@/lib/docFileUpload";
import { formatFileSize, isPreviewableImage } from "@/lib/uploadTypes";
import { commentHint, isFileKind, kindWhat, type ReviewKind } from "@/lib/reviewKinds";
import { openClientComments } from "@/lib/reviewChanges";
import { cleanEdit, mergeEdits, type FrameMode, type PageEdit } from "@/lib/pageFrameProtocol";
import type { PinAnchor } from "@/lib/reviewPins";
import {
  CommentThread, FileDropLine, ImageLightbox, ImagePinBoard, ImageThumbGrid, ImageVersionPicker, commentsFor, nextPin,
  type PreviewImage, type ThreadComment,
} from "@/components/cockpit/TaskWorkItem";

type DocStatus = "draft" | "with_client" | "client_submitted" | "approved" | "completed";
type DocFile = { id: string; name: string; size: number; kind: string; addedBy: string; fromClient: boolean; createdAt: string };
type DocData = {
  kind: ReviewKind; title: string; clientName: string; body: string; version: number; status: DocStatus; approvedAt: string | null;
  closed: boolean; files: DocFile[]; comments: ThreadComment[];
  /** When the team last sent a version; the client's comments count as changes from then. */
  sharedAt: string | null;
  /** An image or page review's versions the client can see, oldest first. body is the
   *  newest. An image review version can hold several images, shown stacked. */
  versionFiles: { body: string; fileId: string; name: string; number: number; fromClient: boolean; images: { fileId: string; name: string; label: string }[] }[];
};
type Notice = { tone: "good" | "info" | "warn"; text: string } | null;
type PinDraft = { fileId: string; x: number; y: number; anchor: PinAnchor | null; number: number };

const NAVY = "#1b3a5c";
const GREEN = "#15803d";

// Keyed by the end of the token, not the whole thing: enough to keep documents
// apart on one device without keeping a working link in browser storage.
const draftKey = (token: string, version: number) => `doc:${token.slice(-12)}:v${version}`;
const pageDraftKey = (token: string, fileId: string) => `doc:${token.slice(-12)}:page:${fileId}`;
function readDraft(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeDraft(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* private browsing: drafts just are not kept */ }
}
/** Page rewording kept on this device for one page file, each piece checked again. */
function readPageEdits(token: string, fileId: string): PageEdit[] {
  try {
    const raw = JSON.parse(readDraft(pageDraftKey(token, fileId)) ?? "[]");
    return Array.isArray(raw) ? raw.map(cleanEdit).filter((e): e is PageEdit => !!e) : [];
  } catch {
    return [];
  }
}
const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
const commentTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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
  const [adding, setAdding] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // Words picked in the document for the next comment, and the comment whose words
  // are shown (Derek, 2026-09-12: comments on a specific sentence).
  const [quoteDraft, setQuoteDraft] = useState<string | null>(null);
  const [focusedComment, setFocusedComment] = useState<string | null>(null);
  // The comment the pointer is over, in the thread or on its pin, lit on both.
  const [hoveredComment, setHoveredComment] = useState<string | null>(null);
  // Image and page reviews: the pin dropped for the next comment, and the version
  // looked at (null follows the newest).
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  // Web page review: the frame for the version shown, how a click works, the width,
  // the client's rewording of the newest page, and a pin to bring into view.
  const [pageFrame, setPageFrame] = useState<{ fileId: string; url: string } | null>(null);
  const [frameNonce, setFrameNonce] = useState(0);
  const [pageMode, setPageMode] = useState<FrameMode>("comment");
  const [pageDevice, setPageDevice] = useState<PageDevice>("desktop");
  const [pageEdits, setPageEdits] = useState<{ fileId: string; edits: PageEdit[] }>({ fileId: "", edits: [] });
  const [pageFocus, setPageFocus] = useState<{ id: string; n: number } | null>(null);

  const image = data?.kind === "image";
  const page = data?.kind === "page";
  const versioned = !!data && isFileKind(data.kind);
  const newestEdits = page && pageEdits.fileId === data?.body ? pageEdits.edits : [];
  // An image is never edited; a page is dirty while it holds rewording not sent.
  const dirty = page ? newestEdits.length > 0 : !versioned && html.trim() !== startHtml.trim();
  const locked = !!data && (data.status === "approved" || data.closed);
  const fileHref = (id: string) => `/api/doc/${encodeURIComponent(token)}/files/${id}`;
  // Photos show as pictures and open in a full screen preview.
  const previewImages: PreviewImage[] = (data?.files ?? [])
    .filter((f) => isPreviewableImage(f.name))
    .map((f) => ({ id: f.id, name: f.name, url: fileHref(f.id), downloadUrl: `${fileHref(f.id)}?download=1` }));
  const baseRef = useRef(0);
  const dirtyRef = useRef(false);
  useEffect(() => { baseRef.current = baseVersion; }, [baseVersion]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // Open a version in the editor, bringing back edits the client left unsent on
  // this device for that same version (or, on a page, that same page file).
  const openVersion = useCallback((d: DocData) => {
    const kept = isFileKind(d.kind) ? null : readDraft(draftKey(token, d.version));
    const start = kept && kept.trim() !== d.body.trim() ? kept : d.body;
    setBaseVersion(d.version);
    setStartHtml(d.body);
    setHtml(start);
    setEditorKey((k) => k + 1);
    setNewer(null);
    const keptEdits = d.kind === "page" && d.body ? readPageEdits(token, d.body) : [];
    if (d.kind === "page") setPageEdits({ fileId: d.body, edits: keptEdits });
    if (start !== d.body || keptEdits.length) setNotice({ tone: "info", text: "We kept your unsent edits from last time." });
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

  // "Viewed 2h ago" for the team (Derek, 2026-09-11). Sent once, after the page
  // has been open and on screen for a few seconds, never by the link's GET: mail
  // scanners open links before the client does. A hidden tab tries again on the
  // next poll, which hands this a fresh `data`.
  const viewedRef = useRef(false);
  useEffect(() => {
    if (state !== "ready" || viewedRef.current) return;
    const id = window.setTimeout(() => {
      if (viewedRef.current || document.visibilityState !== "visible") return;
      viewedRef.current = true;
      void fetch(`/api/doc/${encodeURIComponent(token)}/viewed`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", keepalive: true,
      }).catch(() => {});
    }, 4000);
    return () => window.clearTimeout(id);
  }, [state, token, data]);

  // Keep unsent edits on this device as the client types.
  useEffect(() => {
    if (state !== "ready" || locked || versioned) return;
    const t = window.setTimeout(() => writeDraft(draftKey(token, baseVersion), dirty ? html : null), 400);
    return () => window.clearTimeout(t);
  }, [html, dirty, baseVersion, token, state, locked, versioned]);
  // And a page's rewording, per page file.
  useEffect(() => {
    if (!pageEdits.fileId) return;
    writeDraft(pageDraftKey(token, pageEdits.fileId), pageEdits.edits.length ? JSON.stringify(pageEdits.edits) : null);
  }, [pageEdits, token]);

  const publish = async (kind: "submit" | "approve") => {
    setBusy(kind === "submit" ? "send" : "approve");
    const sentEdits = newestEdits.length > 0;
    try {
      const res = await fetch(`/api/doc/${encodeURIComponent(token)}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(page ? { baseVersion, fileId: data?.body, edits: newestEdits } : { html, baseVersion }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 404) { setState("gone"); return; }
      if (res.status === 409) {
        // Their text stays where it is. They choose whether to load the newer one.
        if (j.current && !page) setNewer(j.current);
        if (page) void load(false);
        setNotice({ tone: "warn", text: j.error ?? "This changed while you were looking." });
        return;
      }
      if (res.status === 429) { setNotice({ tone: "warn", text: "Too many tries. Please wait a moment and try again." }); return; }
      if (!res.ok) { setNotice({ tone: "warn", text: j.error ?? "We couldn't save that. Please try again." }); return; }

      writeDraft(draftKey(token, baseVersion), null);
      if (page) setPageEdits({ fileId: "", edits: [] });
      const version = j.version as number;
      setBaseVersion(version);
      setStartHtml(html);
      setData((d) => d ? {
        ...d, version,
        status: kind === "approve" ? "approved" : "client_submitted",
        approvedAt: kind === "approve" ? new Date().toISOString() : d.approvedAt,
      } : d);
      // A reworded page is a new version: fetch it so the frame shows it.
      if (page && sentEdits) void load(false);
      setNotice(kind === "approve" ? null : { tone: "good", text: "Thanks! We sent your changes to the team. You can keep going and send again anytime." });
    } catch {
      setNotice({ tone: "warn", text: "We couldn't reach the server. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  };

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
    if (page) { setPageEdits({ fileId: "", edits: [] }); setFrameNonce((n) => n + 1); }
    setNotice(null);
  };

  const filesApi = (method: "POST" | "DELETE") => (payload: Record<string, unknown>) =>
    fetch(`/api/doc/${encodeURIComponent(token)}/files`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

  const addFiles = async (list: FileList | null) => {
    if (!list?.length || adding) return;
    setAdding(true);
    setNotice(null);
    const error = await addDocFiles(Array.from(list), filesApi("POST"), () => { void load(false); });
    setAdding(false);
    if (error) setNotice({ tone: "warn", text: error });
    else setNotice({ tone: "good", text: "Added. Your team can see it now." });
  };

  // A file for the next comment: it goes on the document's files first.
  const attachFile = async (file: File) => {
    const up = await uploadSharedFile(file, filesApi("POST"));
    if (!up.ok) { setNotice({ tone: "warn", text: up.error }); return null; }
    void load(false);
    return { id: up.result.fileId as string, name: file.name };
  };

  // A comment shows at once; the 15 second refresh brings the team's replies.
  const postComment = async (body: string, quote?: string | null, attachmentFileId?: string | null) => {
    const pin = versioned && pinDraft ? { fileId: pinDraft.fileId, x: pinDraft.x, y: pinDraft.y, anchor: pinDraft.anchor } : null;
    try {
      const res = await fetch(`/api/doc/${encodeURIComponent(token)}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, quote: quote ?? null, pin, attachmentFileId: attachmentFileId ?? null }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 404) { setState("gone"); return false; }
      if (res.status === 429) { setNotice({ tone: "warn", text: "Too many tries. Please wait a moment and try again." }); return false; }
      if (!res.ok) { setNotice({ tone: "warn", text: j.error ?? "We couldn't post that. Please try again." }); return false; }
      setData((d) => d ? { ...d, comments: [...(d.comments ?? []), j.comment as ThreadComment] } : d);
      setQuoteDraft(null);
      setPinDraft(null);
      return true;
    } catch {
      setNotice({ tone: "warn", text: "We couldn't reach the server. Check your connection and try again." });
      return false;
    }
  };

  // Edit or delete their own comments, tick any comment done.
  const commentRequest = async (method: "PATCH" | "DELETE", payload: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/doc/${encodeURIComponent(token)}/comments`, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 404) { setState("gone"); return null; }
      if (!res.ok) { setNotice({ tone: "warn", text: j.error ?? "We couldn't save that. Please try again." }); return null; }
      return j as { comment?: ThreadComment };
    } catch {
      setNotice({ tone: "warn", text: "We couldn't reach the server. Check your connection and try again." });
      return null;
    }
  };
  const changeComment = async (commentId: string, change: { body?: string; done?: boolean }) => {
    const j = await commentRequest("PATCH", { commentId, ...change });
    if (!j?.comment) return false;
    const next = j.comment;
    setData((d) => d ? { ...d, comments: (d.comments ?? []).map((c) => (c.id === commentId ? next : c)) } : d);
    return true;
  };
  const removeComment = async (commentId: string) => {
    if (!window.confirm("Delete this comment?")) return false;
    if (!(await commentRequest("DELETE", { commentId }))) return false;
    setData((d) => d ? { ...d, comments: (d.comments ?? []).filter((c) => c.id !== commentId) } : d);
    return true;
  };

  const removeFile = async (f: DocFile) => {
    if (!window.confirm(`Remove ${f.name}?`)) return;
    const res = await filesApi("DELETE")({ fileId: f.id });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setNotice({ tone: "warn", text: j.error ?? "We couldn't remove that file. Please try again." }); return; }
    void load(false);
  };

  const renderAttachment = (fileId: string) => {
    const f = data?.files.find((x) => x.id === fileId);
    if (!f) return <span className="text-muted">📎 File removed</span>;
    const preview = previewImages.findIndex((p) => p.id === f.id);
    const cls = "break-words text-left font-semibold underline underline-offset-4";
    return preview >= 0
      ? <button onClick={() => setLightbox(preview)} className={cls} style={{ color: NAVY }}>📎 {f.name}</button>
      : <a href={fileHref(f.id)} target="_blank" rel="noopener noreferrer" className={cls} style={{ color: NAVY }}>📎 {f.name}</a>;
  };

  const noticeTone = { good: "border-[#15803d] bg-[#f0fdf4] text-[#14532d]", info: "border-[#1b3a5c] bg-[#eef4fb] text-[#1b3a5c]", warn: "border-[#b45309] bg-[#fffbeb] text-[#78350f]" };

  // The versions of an image or page review, and the one shown: the newest unless another was picked.
  const versionFiles = data?.versionFiles ?? [];
  // Numbered as published, so a removed version leaves a gap and nothing renumbers.
  const versionOptions = versionFiles.map((v, i) => ({ fileId: v.body, label: i === versionFiles.length - 1 ? `Version ${v.number}, newest` : `Version ${v.number}` }));
  const shownFileId = versioned && data ? (viewingImage && versionFiles.some((v) => v.body === viewingImage) ? viewingImage : data.body) : null;
  // The images of the version shown (one for a page), and the label that tells a pin's image apart.
  const shownImages = versionFiles.find((v) => v.body === shownFileId)?.images ?? [];
  const shownIds = shownImages.map((img) => img.fileId);
  const imagePlace = (fileId: string) => (shownImages.length > 1 ? shownImages.find((img) => img.fileId === fileId)?.label ?? null : null);
  const onNewest = !!data && shownFileId === data.body;
  const noVersion = versioned && !!data && !data.body;
  // The client has changes, the same rule on every kind and on the server: their own
  // edits, or a comment of theirs still open on this round (reviewChanges.ts).
  const newestIds = versioned ? (versionFiles.at(-1)?.images ?? []).map((img) => img.fileId) : [];
  const openNotes = openClientComments(data?.comments ?? [], newestIds, data?.sharedAt ?? null).length;
  const what = data ? kindWhat(data.kind) : "document";

  // The frame for the page version shown, fetched again when it expires or the page navigates.
  const pageFileId = page ? shownFileId : null;
  useEffect(() => {
    if (!pageFileId) return;
    let cancelled = false;
    void fetch(`/api/doc/${encodeURIComponent(token)}/page?fileId=${encodeURIComponent(pageFileId)}`, { cache: "no-store" })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setPageFrame({ fileId: pageFileId, url: j.frameUrl as string });
        else setNotice({ tone: "warn", text: "We couldn't show the page. Please reload." });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pageFileId, frameNonce, token]);

  // A comment picked in the thread: shown on the image, or on the page at the width its pin was dropped at.
  const focusComment = (id: string) => {
    setFocusedComment(id);
    if (!page) return;
    const width = data?.comments.find((c) => c.id === id)?.pin?.anchor?.width;
    if (width) setPageDevice(deviceForWidth(width));
    setPageFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };

  // One action card for every kind (Derek, 2026-09-13: image and HTML reviews "need
  // to be the same as doc"); only how the client comments or changes it differs.
  const how = page
    ? "leave comments on any spot you click, change the wording with Edit text"
    : image ? "leave comments on any spot you click" : "leave comments on any words you select, edit anything you like";
  const intro = `Look it over, ${how}. If it all looks right, approve it. Any comment or edit turns that button into Submit changes.`;
  // One button at a time (Derek, 2026-09-15): Approve while there is nothing to
  // change, Submit changes once the client comments or edits.
  const hasChanges = dirty || openNotes > 0;
  const approveHint = image
    ? "Want something changed? Click a spot on the image to leave a comment."
    : page ? "Want something changed? Click a spot to comment, or use Edit text." : "Want something changed? Select words to comment on them, or edit the text.";
  const changesHint = image ? "To approve instead, delete your comments." : "To approve instead, delete your comments and undo your edits.";

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header style={{ background: NAVY }} className="text-white">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-5">
          <span className="text-[18px] font-bold tracking-wide">ClickUpLocal</span>
          {data && <span className="text-[16px] text-white/85">Prepared for {data.clientName}</span>}
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-5 pb-16 pt-7">
        {state === "loading" && <p className="text-[18px] text-muted">Loading…</p>}

        {state === "error" && (
          <div className="rounded-2xl border bg-surface p-6">
            <p className="text-[20px] font-semibold">We couldn&apos;t load this page.</p>
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
            {!locked && !noVersion && <p className="mt-2 text-[18px] text-muted">{intro}</p>}

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
                <p className="text-[20px] font-semibold">This {what} is closed.</p>
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

            {/* The document on the left, Files and Comments in a sidebar on the
                right, laid out like the team's full screen view (Derek,
                2026-09-11). On a phone the sidebar stacks under the document. */}
            <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              {versioned ? (
                // An image review's artwork sits on the page itself, no card around it
                // (Derek, 2026-09-14 redesign); an HTML review keeps its card.
                <article className={image && shownFileId ? "min-w-0" : "min-w-0 rounded-2xl border bg-surface p-5 shadow-sm sm:p-8"}>
                  {versionOptions.length > 1 && (
                    <div className="mb-3">
                      <ImageVersionPicker options={versionOptions} value={shownFileId} onChange={(id) => { setViewingImage(id); setPinDraft(null); }} />
                    </div>
                  )}
                  {!onNewest && <p className="mb-3 text-[17px] text-muted">This is an earlier version. Its pins are from that round.</p>}
                  {!shownFileId && (
                    <p className="py-12 text-center text-[18px] text-muted">There is no {what} to review right now. We&apos;ll let you know when there is a new one.</p>
                  )}
                  {shownFileId && image && (
                    // A version can hold several images, like a postcard's front and back, stacked with their names (Derek, 2026-09-14).
                    <div className="space-y-8">
                      {shownImages.map((img) => (
                        <section key={`${shownFileId}:${img.fileId}`} aria-label={img.label} data-image-anchor={img.fileId}>
                          {shownImages.length > 1 && <h2 className="mb-2 text-[18px] font-semibold">{img.label}</h2>}
                          <ImagePinBoard src={fileHref(img.fileId)} alt={shownImages.length > 1 ? img.label : img.name}
                            comments={data.comments ?? []} fileId={img.fileId} pending={pinDraft} activeId={focusedComment}
                            onPinClick={setFocusedComment} hoverId={hoveredComment} onPinHover={setHoveredComment}
                            onPlace={data.closed || !onNewest ? undefined : (spot) => setPinDraft({ fileId: img.fileId, ...spot, anchor: null, number: nextPin(data.comments ?? [], img.fileId) })} />
                        </section>
                      ))}
                    </div>
                  )}
                  {shownFileId && page && (
                    <PageReviewFrame
                      frameUrl={pageFrame?.fileId === shownFileId ? pageFrame.url : null}
                      onReload={() => setFrameNonce((n) => n + 1)}
                      mode={pageMode} onMode={setPageMode} device={pageDevice} onDevice={setPageDevice}
                      canEdit={!locked && onNewest} canComment={!data.closed && onNewest} color={NAVY}
                      pins={(data.comments ?? []).filter((c) => c.pin && c.pin.fileId === shownFileId).map((c) => ({
                        id: c.id, number: c.pin!.number, x: c.pin!.x, y: c.pin!.y, anchor: c.pin!.anchor ?? null, done: !!c.completedAt, active: c.id === focusedComment,
                      }))}
                      pending={pinDraft && pinDraft.fileId === shownFileId ? pinDraft : null}
                      focus={pageFocus} edits={onNewest ? newestEdits : []}
                      onPlace={(place) => setPinDraft({ fileId: shownFileId, ...place, number: nextPin(data.comments ?? [], shownFileId) })}
                      onPinClick={setFocusedComment}
                      onEdit={(edit) => setPageEdits((s) => ({ fileId: shownFileId, edits: mergeEdits(s.fileId === shownFileId ? s.edits : [], edit) }))} />
                  )}
                </article>
              ) : (
                <article className="min-w-0 rounded-2xl border bg-surface p-5 shadow-sm sm:p-8">
                  <RichTextEditor key={editorKey} value={html} onChange={setHtml} variant="doc" editable={!locked}
                    placeholder="This document is empty."
                    highlights={(data.comments ?? []).filter((c) => c.quote && !c.completedAt).map((c) => ({ id: c.id, quote: c.quote as string }))}
                    activeHighlightId={focusedComment} onHighlightClick={setFocusedComment}
                    onSelectionComment={data.closed ? undefined : setQuoteDraft} />
                </article>
              )}

              {/* Stays beside the document as it scrolls (Derek, 2026-09-11: "make side
                  bar sticky"). Send my changes and Approve sit at its top, above
                  Files, in place of a bar fixed to the bottom of the screen. */}
              <aside className={`space-y-4 ${image && shownImages.length > 1 ? "" : "lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"}`}>
                {/* Nothing to approve or change while no version is up for review. */}
                {!locked && !noVersion && (
                  <div className="rounded-2xl border bg-surface p-4 shadow-sm">
                    {/* One button at a time: Submit changes once the client has
                        commented or edited, Approve while there is nothing to change. */}
                    {hasChanges ? (
                      <button onClick={() => void publish("submit")} disabled={busy !== null}
                        className="min-h-[52px] w-full rounded-xl px-4 text-[17px] font-bold text-white transition disabled:opacity-60"
                        style={{ background: NAVY }}>
                        {busy === "send" ? "Sending…" : "Submit changes"}
                      </button>
                    ) : (
                      <button onClick={() => void publish("approve")} disabled={busy !== null}
                        className="min-h-[52px] w-full rounded-xl px-4 text-[17px] font-bold text-white transition disabled:opacity-60"
                        style={{ background: GREEN }}>
                        {busy === "approve" ? "Approving…" : "Approve"}
                      </button>
                    )}
                    {dirty && (
                      <button onClick={undoEdits} className="mt-2 min-h-[44px] text-[16px] font-medium text-muted underline underline-offset-4">Undo my edits</button>
                    )}
                    {page && newestEdits.length > 0 && (
                      <p className="mt-1 text-[16px] text-muted">{newestEdits.length === 1 ? "1 text change" : `${newestEdits.length} text changes`} not sent yet.</p>
                    )}
                    <p className="mt-2 text-[16px] text-muted">{hasChanges ? changesHint : approveHint}</p>
                  </div>
                )}

                {/* No Files box on an image or page review: files ride on comments (Derek, 2026-09-12). */}
                {!versioned && (data.files.length > 0 || !locked) && (
                  <FileDropLine label="Files" count={data.files.length} busy={adding} disabled={locked} onFiles={(list) => void addFiles(list)}>
                    {previewImages.length > 0 && <ImageThumbGrid images={previewImages} onOpen={setLightbox} />}
                    {data.files.length > 0 && (
                      <ul className="mt-1.5 divide-y">
                        {data.files.map((f) => {
                          const href = fileHref(f.id);
                          const preview = previewImages.findIndex((p) => p.id === f.id);
                          const nameClass = "min-w-0 break-words text-left font-semibold underline underline-offset-4";
                          return (
                            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[16px]">
                              {preview >= 0
                                ? <button onClick={() => setLightbox(preview)} className={nameClass} style={{ color: NAVY }}>{f.name}</button>
                                : <a href={href} target="_blank" rel="noopener noreferrer" className={nameClass} style={{ color: NAVY }}>{f.name}</a>}
                              <span className="text-muted">{formatFileSize(f.size)} · {f.fromClient ? "You" : f.addedBy}</span>
                              <span className="ml-auto flex items-center gap-3">
                                <a href={`${href}?download=1`} className="min-h-[44px] content-center font-medium underline underline-offset-4" style={{ color: NAVY }}>Download</a>
                                {f.fromClient && !locked && (
                                  <button onClick={() => void removeFile(f)} className="min-h-[44px] font-medium text-muted underline underline-offset-4">Remove</button>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </FileDropLine>
                )}
                <CommentThread comments={versioned ? commentsFor(data.comments ?? [], shownIds) : data.comments ?? []}
                  pinLabel={image ? imagePlace : undefined} pinGroups={image ? shownImages.map((img) => img.label) : undefined}
                  alignGroup={image ? (label) => {
                    const img = shownImages.find((x) => x.label === label);
                    return img ? document.querySelector<HTMLElement>(`[data-image-anchor="${img.fileId}"]`) : null;
                  } : undefined} pinDraftLabel={image && pinDraft ? imagePlace(pinDraft.fileId) : null}
                  pinTone={image ? "var(--highlight)" : undefined} hoverId={image ? hoveredComment : undefined} onHover={image ? setHoveredComment : undefined}
                  onPost={postComment} when={commentTime} viewer="client" buttonStyle={{ background: NAVY }}
                  isMine={(c) => c.fromClient} canDelete={(c) => c.fromClient}
                  onEdit={(id, body) => changeComment(id, { body })}
                  onToggleDone={(id, done) => changeComment(id, { done })}
                  onDelete={removeComment}
                  quote={versioned ? null : quoteDraft} pinDraft={versioned ? pinDraft?.number ?? null : null}
                  onClearQuote={() => { setQuoteDraft(null); setPinDraft(null); }}
                  placeholder={commentHint(data.kind)}
                  onAttach={locked ? undefined : attachFile} renderAttachment={renderAttachment}
                  focusedId={focusedComment} onQuoteClick={focusComment} />
              </aside>
            </div>
          </>
        )}
      </main>

      {lightbox !== null && previewImages[lightbox] && (
        <ImageLightbox images={previewImages} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
