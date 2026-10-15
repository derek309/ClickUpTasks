"use client";

// The HTML review's own bars (Derek, 2026-10-15, html-review-mockup.html), shared
// by the team's window and the client's review page: the status as a sentence,
// the mode bar (Comment, the default, Edit and ▶ Preview), Preview's bar (back to
// editing, the widths, and the kind's own extra), an email's inbox header, and
// the fields on top (an email's subject and preview text, a page's title,
// description and address). Text is 16px or more, corners 5px, nothing sticks.
import { useEffect, useState, type ReactNode } from "react";
import type { FrameMode } from "@/lib/pageFrameProtocol";
import type { PageKind, ReviewMeta } from "@/lib/htmlReview";
import { MODES, PAGE_DEVICES, type PageDevice } from "./PageReviewFrame";

const DOT = { ours: "#dc2626", theirs: "#d97706", approved: "#15803d" } as const;

/** "● Your turn, version 1, not sent yet", the way a step says it. */
export function TurnLine({ who, rest, dot, className = "" }: { who: string; rest: string; dot: keyof typeof DOT; className?: string }) {
  return (
    <p className={`flex min-w-0 items-baseline gap-2 text-[17px] leading-snug ${className}`}>
      <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: DOT[dot] }} />
      <span className="min-w-0"><span className="font-semibold underline decoration-dotted decoration-[1.5px] underline-offset-4">{who}</span>{rest}</span>
    </p>
  );
}

const segment = (on: boolean, color?: string) =>
  `h-10 px-4 text-[16px] font-semibold transition ${on ? (color ? "text-white" : "bg-accent text-white") : "bg-surface text-foreground hover:bg-background"}`;
export const ghostButton = "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] bg-surface px-3 text-[16px] font-semibold ring-1 ring-inset ring-border hover:bg-background disabled:opacity-50";

/** Comment | Edit, then ▶ Preview, with what a click does now. */
export function ModeBar({ mode, onMode, canEdit, canComment = true, onPreview, color }: {
  mode: FrameMode; onMode: (m: FrameMode) => void; canEdit: boolean; canComment?: boolean; onPreview: () => void; color?: string;
}) {
  const modes = MODES.filter((m) => m.mode !== "browse" && (m.mode === "edit" ? canEdit : canComment));
  const current = modes.find((m) => m.mode === mode) ?? modes[0];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {modes.length > 1 && (
        <div role="radiogroup" aria-label="What a click does" className="inline-flex overflow-hidden rounded-[5px] ring-1 ring-inset ring-border">
          {modes.map((m) => (
            <button key={m.mode} role="radio" aria-checked={current?.mode === m.mode} onClick={() => onMode(m.mode)}
              className={segment(current?.mode === m.mode, color)} style={current?.mode === m.mode && color ? { background: color } : undefined}>{m.label}</button>
          ))}
        </div>
      )}
      <button onClick={onPreview} className={ghostButton}><span aria-hidden>▶</span> Preview</button>
      {current && <span className="min-w-0 text-[16px] text-muted">{current.hint}</span>}
    </div>
  );
}

/** Preview's bar: back to editing, the widths, and the kind's own extra. */
export function PreviewBar({ onBack, backLabel = "‹ Back to editing", device, onDevice, devices, extra, color }: {
  onBack: () => void; backLabel?: string; device: PageDevice; onDevice: (d: PageDevice) => void; devices: PageDevice[]; extra?: ReactNode; color?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button onClick={onBack} className="h-10 text-[16px] font-semibold hover:underline" style={{ color: color ?? "var(--accent)" }}>{backLabel}</button>
      <span className="flex-1" />
      <div role="radiogroup" aria-label="Page width" className="inline-flex overflow-hidden rounded-[5px] ring-1 ring-inset ring-border">
        {devices.map((d) => (
          <button key={d} role="radio" aria-checked={device === d} onClick={() => onDevice(d)}
            className={segment(device === d, color)} style={device === d && color ? { background: color } : undefined}>{PAGE_DEVICES[d].label}</button>
        ))}
      </div>
      {extra}
    </div>
  );
}

/** An email's subject and preview text, the way an inbox shows them, above the email in Preview. */
export function InboxHeader({ subject, previewText }: { subject: string; previewText: string }) {
  if (!subject.trim() && !previewText.trim()) return null;
  return (
    <div className="mx-auto mb-3 w-full max-w-[640px] rounded-[5px] border bg-surface px-4 py-3 text-[16px]">
      <p className="font-bold [overflow-wrap:anywhere]">{subject.trim() || "No subject yet"}</p>
      {previewText.trim() && <p className="text-muted [overflow-wrap:anywhere]">{previewText}</p>}
    </div>
  );
}

type FieldKey = Exclude<keyof ReviewMeta, "pageKind">;
const FIELDS: Record<PageKind, { key: FieldKey; label: string; placeholder: string; max: number }[]> = {
  email: [
    { key: "subject", label: "Subject", placeholder: "What the inbox shows first", max: 200 },
    { key: "previewText", label: "Preview text", placeholder: "The line under the subject", max: 300 },
  ],
  page: [
    { key: "pageTitle", label: "Page title", placeholder: "The name in the browser tab", max: 200 },
    { key: "description", label: "Google description", placeholder: "What Google shows under the title", max: 320 },
    { key: "slug", label: "Address", placeholder: "the-page-address", max: 120 },
  ],
};

/** The fields on top of the review, saved as each one is left. */
export function ReviewFields({ kind, meta, onSave, disabled }: { kind: PageKind; meta: ReviewMeta; onSave: (change: ReviewMeta) => void; disabled?: boolean }) {
  const fields = FIELDS[kind];
  const saved = JSON.stringify(fields.map((f) => meta[f.key] ?? ""));
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, meta[f.key] ?? ""])));
  // A save, a switch of kind or another teammate's change comes back in.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDraft(Object.fromEntries(fields.map((f) => [f.key, meta[f.key] ?? ""]))); }, [saved, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const leave = (key: FieldKey) => { if ((draft[key] ?? "") !== (meta[key] ?? "")) onSave({ [key]: draft[key] ?? "" }); };
  return (
    <div className="mb-4 grid gap-2">
      {fields.map((f) => (
        <label key={f.key} className="grid gap-1 rounded-[5px] border bg-surface px-3 py-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center sm:gap-3">
          <span className="text-[16px] font-semibold text-muted">{f.label}</span>
          <input value={draft[f.key] ?? ""} maxLength={f.max} disabled={disabled} placeholder={f.placeholder}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            onBlur={() => leave(f.key)}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            className="h-10 min-w-0 rounded-[5px] bg-transparent px-1 text-[16px] outline-none placeholder:text-muted focus:bg-background disabled:opacity-70" />
        </label>
      ))}
    </div>
  );
}
