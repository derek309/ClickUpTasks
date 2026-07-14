"use client";

// Shared UI primitives for the Cockpit: the icon set, Avatar, misc formatting
// helpers, and the list-view column definitions. Split out of Cockpit.tsx.
import { useState } from "react";
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
};

export function Avatar({ id, size = 26 }: { id: string | null; size?: number }) {
  const u = userById(id);
  if (!u) return (<span className="inline-flex items-center justify-center rounded-full border border-dashed text-muted" style={{ width: size, height: size, fontSize: size * 0.42 }}><I.user /></span>);
  if (u.avatarUrl) return (
    // eslint-disable-next-line @next/next/no-img-element -- sizes are dynamic per call site; next/image's fixed-dimension model doesn't fit this many tiny inline avatars.
    <img src={u.avatarUrl} alt={u.name} title={u.name} className="rounded-full object-cover" style={{ width: size, height: size }} />
  );
  return (<span className="inline-flex items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: u.color, fontSize: size * 0.4 }} title={u.name}>{u.initials}</span>);
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

export function SideItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (<button onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[15px] transition ${active ? "bg-accent-soft font-medium text-accent" : "text-foreground hover:bg-background"}`}>{children}</button>);
}
export function LabelChips({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (<div className="mt-1.5 flex flex-wrap gap-1">{ids.map((id) => { const l = labelById(id); return l ? (<span key={id} className="rounded px-1.5 py-0 text-[13px] font-medium" style={{ background: l.color + "1a", color: l.color }}>{l.name}</span>) : null; })}</div>);
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div className="flex items-center gap-3"><dt className="w-24 shrink-0 text-[13px] font-medium text-muted">{label}</dt><dd className="min-w-0 flex-1">{children}</dd></div>);
}



export function renderMentions(body: string) {
  const parts = body.split(/(@[A-Za-z]+ [A-Za-z]+)/g);
  return parts.map((p, i) => { const isMention = users.some((u) => "@" + u.name === p); return isMention ? (<span key={i} className="rounded bg-accent-soft px-1 font-medium text-accent">{p}</span>) : <span key={i}>{p}</span>; });
}

// Meeting transcripts, long emails, and long comments would otherwise push
// everything else off-screen — collapse past this many words behind a "Show
// more" toggle. A plain clickable span, not a <button>, so this still works
// nested inside a parent <button> (e.g. the Task Activity rollup row).
const LONG_TEXT_WORD_THRESHOLD = 200;
export function CollapsibleText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const words = text.trim().split(/\s+/);
  const isLong = words.length > LONG_TEXT_WORD_THRESHOLD;
  const shown = isLong && !expanded ? words.slice(0, LONG_TEXT_WORD_THRESHOLD).join(" ") + "…" : text;
  const toggle = (e: React.SyntheticEvent) => { e.stopPropagation(); setExpanded((x) => !x); };
  return (
    <div className={className}>
      {renderMentions(shown)}
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
export type SortBy = "manual" | "due" | "priority" | "title" | "status" | "assignee" | "comments";
export const LIST_COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: "status", label: "Stage", sortable: true },
  { key: "priority", label: "Priority", sortable: true },
  { key: "due", label: "Due date", sortable: true },
  { key: "comments", label: "Comments", sortable: true },
  { key: "contact", label: "Contact", sortable: false },
  { key: "labels", label: "Labels", sortable: false },
];
export const COL_WIDTHS: Record<string, string> = { status: "128px", due: "96px", priority: "104px", comments: "84px", assignee: "72px", contact: "160px", labels: "150px" };
export type Toast = { id: string; text: string };
