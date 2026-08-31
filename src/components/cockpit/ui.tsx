"use client";

// Shared UI primitives for the Cockpit: the icon set, Avatar, misc formatting
// helpers, and the list-view column definitions. Split out of Cockpit.tsx.
import { useEffect, useRef, useState } from "react";
import { users, userById, labelById, type Attachment, type TaskStatus, type Priority } from "@/lib/data";

// --- tiny inline icons ------------------------------------------------------

export const I = {
  grid: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>),
  inbox: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>),
  comment: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="14" height="14"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/></svg>),
  clip: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="14" height="14"><path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>),
  check: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="13" height="13"><path d="M20 6L9 17l-5-5"/></svg>),
  plus: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="16" height="16"><path d="M12 5v14M5 12h14"/></svg>),
  close: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="18" height="18"><path d="M18 6L6 18M6 6l12 12"/></svg>),
  search: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>),
  user: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"/></svg>),
  calendar: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>),
  bolt: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="currentColor" className={p.className} width="12" height="12"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>),
  flag: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="currentColor" className={p.className} width="12" height="12"><path d="M4 22V4h13l-1.5 4L17 12H6v10z"/></svg>),
  repeat: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="12" height="12"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>),
  list: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>),
  star: (p: { className?: string; filled?: boolean }) => (<svg viewBox="0 0 24 24" fill={p.filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>),
  bookmark: (p: { className?: string; filled?: boolean }) => (<svg viewBox="0 0 24 24" fill={p.filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" className={p.className} width="14" height="14"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>),
  folder: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>),
  link: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M10 14a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1 1"/><path d="M14 10a5 5 0 0 0-7.07 0l-2 2a5 5 0 0 0 7.07 7.07l1-1"/></svg>),
  bell: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="17" height="17"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>),
  pencil: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>),
  trash: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>),
  grip: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="currentColor" className={p.className} width="12" height="12"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>),
  chevron: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="14" height="14"><path d="M15 18l-6-6 6-6"/></svg>),
  sun: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="15" height="15"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>),
  moon: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="15" height="15"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>),
  menu: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="18" height="18"><path d="M3 6h18M3 12h18M3 18h18"/></svg>),
  logout: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="15" height="15"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>),
  dots: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="currentColor" className={p.className} width="16" height="16"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>),
  filter: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>),
  expand: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>),
  minimize: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><path d="M9 3v6H3M21 15h-6v6M15 9l6-6M3 21l6-6"/></svg>),
  gear: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
  clipboard: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="16" height="16"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4"/><path d="M8 11h8M8 15h5"/></svg>),
  tag: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M20.59 13.41L11 3.83A2 2 0 0 0 9.57 3H4a1 1 0 0 0-1 1v5.57a2 2 0 0 0 .83 1.43l9.58 9.58a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.82z"/><circle cx="7.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/></svg>),
  bold: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="13" height="13"><path d="M6 4h7a3.5 3.5 0 0 1 0 7H6zM6 11h8a3.5 3.5 0 0 1 0 7H6z"/></svg>),
  italic: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="13" height="13"><path d="M11 4h7M6 20h7M13 4L10 20"/></svg>),
  underline: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} width="13" height="13"><path d="M6 4v6a6 6 0 0 0 12 0V4M4 21h16"/></svg>),
  quote: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="currentColor" className={p.className} width="13" height="13"><path d="M6 5C3.8 5 2 6.8 2 9v6h6V9H4.5C4.8 7.3 6.1 6 8 6V5H6zm10 0c-2.2 0-4 1.8-4 4v6h6V9h-3.5c.3-1.7 1.6-3 3.5-3V5h-2z"/></svg>),
  code: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M8 6L2 12l6 6M16 6l6 6-6 6"/></svg>),
  key: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="15" height="15"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.5 12.5L20 3M20 3v5h-5M17 6l-3 3"/></svg>),
  download: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="13" height="13"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>),
  clock: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="14" height="14"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>),
  mail: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="14" height="14"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>),
  phone: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="14" height="14"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.32 1.85.55 2.81.68A2 2 0 0 1 22 16.92z"/></svg>),
  // Two overlapping bubbles — distinct at a glance from the single-bubble
  // `comment` icon used for internal team chat, since they sit right next
  // to each other in the same tab bar.
  chatBubbles: (p: { className?: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={p.className} width="14" height="14"><path d="M8 10a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1a5 5 0 0 1-5 5h-1l-3 2.5V16h0a5 5 0 0 1-5-5z"/><path d="M8 17.5A4.5 4.5 0 0 1 3.5 13V8"/></svg>),
};

export function Avatar({ id, size = 26 }: { id: string | null; size?: number }) {
  const u = userById(id);
  // Proportional radius (not a fixed Tailwind class) so the "rounded square"
  // look stays consistent across the whole 14-32px range this is used at —
  // a fixed radius would read as barely-rounded at 32px but nearly circular
  // at 14px.
  const radius = Math.round(size * 0.28);
  if (!u) return (<span className="inline-flex items-center justify-center border border-dashed text-muted" style={{ width: size, height: size, fontSize: size * 0.42, borderRadius: radius }}><I.user /></span>);
  if (u.avatarUrl) return (
    // eslint-disable-next-line @next/next/no-img-element -- sizes are dynamic per call site; next/image's fixed-dimension model doesn't fit this many tiny inline avatars.
    <img src={u.avatarUrl} alt={u.name} title={u.name} className="object-cover" style={{ width: size, height: size, borderRadius: radius }} />
  );
  return (<span className="inline-flex items-center justify-center font-semibold text-white" style={{ width: size, height: size, background: u.color, fontSize: size * 0.4, borderRadius: radius }} title={u.name}>{u.initials}</span>);
}

// Flat file-type badge — replaces platform-inconsistent emoji, respects theme
// via existing color tokens instead of raw Tailwind palette colors.
const FILE_BADGE: Record<Attachment["kind"], { label: string; fg: string; bg: string }> = {
  pdf: { label: "PDF", fg: "text-danger", bg: "bg-danger-soft" },
  image: { label: "IMG", fg: "text-accent", bg: "bg-accent-soft" },
  sheet: { label: "XLS", fg: "text-success", bg: "bg-success-soft" },
  doc: { label: "DOC", fg: "text-muted", bg: "bg-background" },
  link: { label: "URL", fg: "text-accent", bg: "bg-accent-soft" },
};
export function FileBadge({ kind }: { kind: Attachment["kind"] }) {
  const b = FILE_BADGE[kind];
  return (<span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[9px] font-bold ${b.fg} ${b.bg}`}>{b.label}</span>);
}
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB — keep in sync with the Supabase bucket's file-size limit
let idCounter = 0;
export const newId = (p: string) => p + Date.now().toString(36) + (idCounter++).toString(36);
export function formatBytes(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
export function kindFromName(name: string): Attachment["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["pdf"].includes(ext)) return "pdf";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  return "doc";
}


// --- small building blocks --------------------------------------------------

export function SideItem({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (<button onClick={onClick} title={title} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[15px] transition ${active ? "bg-accent-soft font-medium text-accent" : "text-foreground hover:bg-background"}`}>{children}</button>);
}
// Small on/off switch, shared by NotificationPrefsPanel's per-user email
// toggles and any admin-facing app-wide toggle (e.g. the sidebar's DMs switch).
export function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onClick}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-accent" : "bg-muted/30"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  );
}
// A drop-in replacement for a <select> whose option list got long enough that
// scanning it is the slow part — the client pickers especially, where the list
// runs to dozens of names. Closed, it looks and sits exactly like the plain
// select it replaces. Open, it puts a filter box above the options: typing
// narrows the list, Up/Down move the highlight, Enter picks, Escape closes
// (and stops there, so it never also closes the modal the picker lives in).
export type SearchOption = { value: string; label: string; sub?: string };

export function SearchableSelect({
  value, options, onChange, placeholder = "Select…", searchPlaceholder = "Type to filter…",
  className = "", disabled, title, emptyLabel = "No matches",
}: {
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  // Which way the popover opens. It used to be hardcoded below the trigger,
  // which broke the moment a caller sat near the bottom of the window — the
  // bulk-action bar is pinned there, so "Move to…" dropped its list straight
  // off the screen (Derek, 2026-08-26). Decided when it opens, from the space
  // actually available, so it works wherever a caller puts it.
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? options.filter((o) => o.label.toLowerCase().includes(ql) || (o.sub ?? "").toLowerCase().includes(ql))
    : options;

  // The popover is absolutely positioned, so a click anywhere else has to
  // dismiss it or it hangs over unrelated UI.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx, open]);

  const close = () => { setOpen(false); setQ(""); setIdx(0); };
  // Search row (~44px) plus the list's max-h-64 (256px) plus a little margin:
  // the tallest the popover can get. Flip up only when below genuinely can't
  // fit AND above has more room, so a trigger in a short window doesn't flip
  // into an even tighter gap.
  const POPOVER_MAX_H = 312;
  const openMenu = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      setDropUp(below < POPOVER_MAX_H && r.top > below);
    }
    setOpen(true);
    setIdx(0);
  };
  const pick = (v: string) => { onChange(v); close(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[idx]) pick(shown[idx].value); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  };

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button type="button" disabled={disabled} title={title}
        onClick={() => { if (open) close(); else openMenu(); }}
        className={`flex w-full items-center gap-1.5 text-left outline-none disabled:opacity-50 ${className}`}>
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-muted"}`}>{selected?.label ?? placeholder}</span>
        <I.chevron className="shrink-0 -rotate-90 text-muted" />
      </button>
      {open && (
        <div className={`absolute left-0 z-50 w-full min-w-[220px] overflow-hidden rounded-lg border bg-surface shadow-soft-md ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
          <div className="flex items-center gap-1.5 border-b px-2.5 py-2">
            <I.search className="shrink-0 text-muted" />
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey}
              placeholder={searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
            {shown.length === 0 && <div className="px-2.5 py-4 text-center text-[13px] text-muted">{emptyLabel}</div>}
            {shown.map((o, i) => (
              <button key={o.value} type="button" data-i={i} onMouseEnter={() => setIdx(i)} onClick={() => pick(o.value)}
                className={`flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left ${i === idx ? "bg-background" : ""} ${o.value === value ? "text-accent" : ""}`}>
                <span className="w-full truncate text-[13px]">{o.label}</span>
                {o.sub && <span className="w-full truncate text-[12px] text-muted">{o.sub}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// "Sticky scroll to latest" for a message feed — shared by TeamChat (team +
// DMs) and ClientJournal (notes/email/SMS feed). Auto-follows new messages
// only while already scrolled to the bottom, so reading older history isn't
// yanked away by an incoming message; also exposes what a "Jump to latest"
// button needs. Wire the scroll container's ref + onScroll to this, and
// call followIfAtBottom from an effect keyed on the feed's length.
export function useStickyBottom<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  // Mirrors `atBottom` in a ref too: followIfAtBottom is called from an
  // effect keyed only on the feed's length, so it needs the CURRENT value
  // without the effect re-running every time atBottom itself changes.
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const checkAtBottom = () => {
    const el = ref.current;
    if (!el) return;
    const next = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    atBottomRef.current = next;
    setAtBottom(next);
  };
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setAtBottom(true);
  };
  // "auto" (no animation) — a burst of several messages arriving at once
  // shouldn't each trigger their own smooth-scroll animation.
  const followIfAtBottom = () => { if (atBottomRef.current) scrollToBottom("auto"); };
  return { ref, atBottom, checkAtBottom, scrollToBottom, followIfAtBottom };
}

export function JumpToLatestButton({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <button onClick={onClick} title="Jump to the latest message"
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-[5px] bg-accent px-3 py-1.5 text-[13px] font-medium text-white shadow-soft-md hover:opacity-90">
      <I.chevron className="rotate-90" /> Jump to latest
    </button>
  );
}

export function LabelChips({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (<div className="mt-1.5 flex flex-wrap gap-1">{ids.map((id) => { const l = labelById(id); return l ? (<span key={id} className="rounded px-1.5 py-0 text-[13px] font-medium" style={{ background: l.color + "1a", color: l.color }}>{l.name}</span>) : null; })}</div>);
}

export function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (<div className="flex items-center gap-3"><dt className="flex w-28 shrink-0 items-center gap-1.5 text-[13px] font-medium text-muted">{icon}{label}</dt><dd className="min-w-0 flex-1">{children}</dd></div>);
}



export function renderMentions(body: string) {
  const parts = body.split(/(@[A-Za-z]+ [A-Za-z]+)/g);
  return parts.map((p, i) => { const isMention = users.some((u) => "@" + u.name === p); return isMention ? (<span key={i} className="rounded bg-accent-soft px-1 font-medium text-accent">{p}</span>) : <span key={i}>{p}</span>; });
}

// [ and ] are excluded too: GHL's own HTML-to-plaintext conversion of a
// source email sometimes renders an inline image as "[image-url]" directly
// followed by the next link's URL with no space between them — without this
// exclusion the greedy match swallows straight through the "]" and merges
// both URLs into one garbled link.
const URL_RE = /(https?:\/\/[^\s<>"'[\]]+)/g;
// Sentence-ending punctuation (or a closing paren from "(see https://x.com)")
// commonly gets swept into the match — strip it back off the link itself and
// render it as plain trailing text instead.
const URL_TRAILING_PUNCT_RE = /[).,;:!?\]}'"]+$/;

// Plain URLs typed into a comment/message/note body — unlike a task
// description (a TipTap editor with autolink built in) — were rendered as
// inert text with no way to click through. Splits on URLs first, then runs
// the existing mention-highlighting over whatever's left.
export function renderRichText(body: string) {
  return body.split(URL_RE).map((part, i) => {
    if (i % 2 === 0) return <span key={i}>{renderMentions(part)}</span>;
    const trailing = part.match(URL_TRAILING_PUNCT_RE)?.[0] ?? "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    return (
      <span key={i}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{url}</a>
        {trailing}
      </span>
    );
  });
}

// Meeting transcripts, long emails, and long comments would otherwise push
// everything else off-screen — collapse past this many words behind a "Show
// more" toggle. A plain clickable span, not a <button>, so this still works
// nested inside a parent <button> (e.g. the Task Activity rollup row).
// A short preview by default (Derek, 2026-08-11 — "only show like 150
// characters and then read more"): a full newsletter body pasted into the
// feed ran for screens, burying every other message. Characters rather than
// words, since one 40-word paragraph and one 40-word list of tracking URLs
// take up wildly different amounts of room.
const LONG_TEXT_CHAR_THRESHOLD = 150;
// A signature/address block (several short lines) reads as "long" — pushes
// the card tall and clunky — well before it hits the character limit above.
// Whichever limit is crossed first decides how the preview gets truncated.
const LONG_TEXT_LINE_THRESHOLD = 6;
// `maxChars`/`maxLines` default to the thresholds above — every existing
// caller keeps its current behavior. C5: a conversation pane distinguishes
// inbound (generous, ~12 lines) from outbound (tight, ~2 lines — the user
// wrote it, they don't need "Show more" on their own message) by passing
// wider or narrower limits, rather than every caller getting one fixed rule.
export function CollapsibleText({ text, className, maxChars = LONG_TEXT_CHAR_THRESHOLD, maxLines = LONG_TEXT_LINE_THRESHOLD }: { text: string; className?: string; maxChars?: number; maxLines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  const overCharLimit = trimmed.length > maxChars;
  const overLineLimit = lines.length > maxLines;
  const isLong = overCharLimit || overLineLimit;
  // Cut on a word boundary so the preview doesn't end mid-word.
  const charPreview = () => {
    const cut = trimmed.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
  };
  const shown = !isLong || expanded
    ? text
    : (overCharLimit ? charPreview() : lines.slice(0, maxLines).join("\n")) + "…";
  const toggle = (e: React.SyntheticEvent) => { e.stopPropagation(); setExpanded((x) => !x); };
  // break-words so a long unbroken string (a long URL, most commonly) wraps
  // instead of forcing the whole feed to scroll horizontally.
  // whitespace-pre-wrap because renderRichText emits inline spans, so every
  // newline in a stored body was collapsing to a space and a paragraphed
  // email arrived as one run-on wall of text. The bodies already carry their
  // line breaks; nothing was ever rendering them. Safe to turn on here rather
  // than per caller: splitMessageUrls already caps runs at one blank line, so
  // this can't open up a gap-riddled card.
  return (
    <div className={`whitespace-pre-wrap break-words ${className ?? ""}`}>
      {renderRichText(shown)}
      {isLong && (
        <span role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); } }}
          className="mt-1 block cursor-pointer text-[13px] font-medium text-accent hover:underline">
          {expanded ? "Show less" : "Show more"}
        </span>
      )}
    </div>
  );
}

export type FilterState = { status: TaskStatus | "all"; assignee: string; priority: Priority | "all" };
export type SortBy = "manual" | "due" | "followUp" | "priority" | "title" | "status" | "assignee" | "comments" | "created";
// Comments moved inline next to the task title, shown only when non-zero —
// stays sortable via onSort even without a column header (Cockpit's sort
// menu still offers it). Priority came back as a real column (Derek,
// 2026-08-24): the leading-edge color bar alone left no way to change a
// task's priority from the row.
export const LIST_COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: "status", label: "Stage", sortable: true },
  { key: "priority", label: "Priority", sortable: true },
  // Before Due, not after: a follow-up is the date you act on, and the due
  // date is the promise it is working toward. Reading left to right that is
  // "when do I pick this up" then "when is it owed".
  { key: "followUp", label: "Follow up", sortable: true },
  { key: "due", label: "Due date", sortable: true },
  // Created is the start date: Derek wants to see how long something has been
  // sitting, not just when it's owed ("the creation date is the start date, I
  // just want to know when it's created and when it's due").
  { key: "created", label: "Created", sortable: true },
  { key: "contact", label: "Contact", sortable: false },
  { key: "labels", label: "Labels", sortable: false },
];
// One row in the Clients or Projects directory. Both files carried an
// identical copy of this string, so tightening one silently left the other
// bulky — they're the same row to a reader, so they're one constant now.
// Tightened 2026-08-26 (t_mtaue1ew9, Derek: "they're a little big and
// bulky"): the task list's own rows are min-h-[40px]/py-1.5, so these were
// the outlier. Spacing only, no smaller type.
export const DIR_ROW = "group flex min-h-[38px] cursor-pointer items-center gap-2.5 border-b px-4 py-1.5 transition-colors last:border-0 hover:bg-accent-soft/50";

// status is wider than the label needs: the one-click done toggle sits beside
// it (see GroupedList's doneToggle), and at 128px "Changes" plus the circle
// clipped.
export const COL_WIDTHS: Record<string, string> = { status: "152px", due: "132px", followUp: "120px", created: "88px", priority: "132px", comments: "84px", assignee: "72px", contact: "160px", labels: "150px" };
// `action` powers undo: a bulk edit hands back a one-click revert instead of
// leaving someone to re-set every task by hand. Toasts carrying an action
// stay on screen longer (see pushToast) so there's time to actually hit it.
export type Toast = { id: string; text: string; action?: { label: string; run: () => void }; secondaryAction?: { label: string; run: () => void } };
