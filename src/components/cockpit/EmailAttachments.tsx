"use client";

// An email's attachments as pictures (Derek, 2026-10-17: "what's attached,
// what's not attached", "titles are not helpful, we need to see the images").
// Attached files sit on top as thumbnails with an × each; the task's files sit
// under "Add from this task" in the same grid, a tap adding one and a second
// tap taking it off. Links never show here. The email window and the inline
// reply both use it.
import { useEffect, useState } from "react";
import type { Attachment } from "@/lib/data";
import { signedUrlForFile } from "@/lib/db";
import { canShowPicture, displayFileName, fileTypeLabel, taskAttachChoices } from "@/lib/attachFiles";

/** Signed links for the pictures among these files, by storage path. */
export function useFileThumbs(items: Attachment[]): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const paths = [...new Set(items.filter(canShowPicture).map((a) => a.path!))].join("|");
  useEffect(() => {
    const missing = paths ? paths.split("|").filter((p) => !thumbs[p]) : [];
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async (p) => [p, await signedUrlForFile(p, 3600)] as const)).then((pairs) => {
      if (!cancelled) setThumbs((t) => ({ ...t, ...Object.fromEntries(pairs.filter((pair): pair is readonly [string, string] => !!pair[1])) }));
    });
    return () => { cancelled = true; };
  }, [paths]); // eslint-disable-line react-hooks/exhaustive-deps
  return thumbs;
}

/** 3 across on a phone, as many 120px tiles as fit from sm up. */
export const thumbGrid = "grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] sm:gap-3";

/** One file, 88px tall: the picture itself, or a file icon with its type. */
function Face({ a, url }: { a: Attachment; url?: string }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- a signed storage link
    return <img src={url} alt="" onError={() => setBroken(true)} className="block h-full w-full object-cover" />;
  }
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted">
      <svg aria-hidden viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" />
      </svg>
      <span className="text-[16px] font-semibold leading-none">{fileTypeLabel(a)}</span>
    </span>
  );
}

/** An attached file: tap the picture to see it full size, × takes it off. */
export function AttachedThumb({ a, url, onRemove, onOpen }: { a: Attachment; url?: string; onRemove: () => void; onOpen?: () => void }) {
  const name = displayFileName(a.name);
  return (
    <div className="relative min-w-0">
      <button type="button" onClick={onOpen} disabled={!onOpen} title={onOpen ? `View ${name}` : name} aria-label={onOpen ? `View ${name}` : name}
        className="block h-[88px] w-full overflow-hidden rounded-[5px] bg-background ring-1 ring-inset ring-[var(--border)] enabled:hover:ring-accent">
        <Face a={a} url={url} />
      </button>
      <button type="button" onClick={onRemove} title={`Take ${name} off`} aria-label={`Remove ${name}`}
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-[5px] bg-black/65 text-[18px] leading-none text-white hover:bg-danger">×</button>
      <span className="mt-1 block truncate text-[16px]" title={name}>{name}</span>
    </div>
  );
}

/** A task file on offer: a tap attaches it, a second tap takes it off. */
function ChoiceThumb({ a, url, state, onToggle }: { a: Attachment; url?: string; state: "attached" | "available" | "gmailOnly"; onToggle: () => void }) {
  const name = displayFileName(a.name);
  if (state === "gmailOnly") {
    return (
      <div className="min-w-0 opacity-50" title={`${name} is only in Gmail, so it can't be attached from here`}>
        <div className="h-[88px] w-full overflow-hidden rounded-[5px] bg-background ring-1 ring-inset ring-[var(--border)]"><Face a={a} /></div>
        <span className="mt-1 block truncate text-[16px]">{name}</span>
        <span className="block text-[16px] text-muted">Only in Gmail</span>
      </div>
    );
  }
  const on = state === "attached";
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} title={on ? `Attached. Tap to take ${name} off` : `Attach ${name}`}
      className="group relative block min-w-0 self-start text-left">
      <span className={`block h-[88px] w-full overflow-hidden rounded-[5px] bg-background ring-inset ${on ? "opacity-50 ring-2 ring-accent" : "ring-1 ring-[var(--border)] group-hover:ring-accent"}`}>
        <Face a={a} url={url} />
      </span>
      {/* ✓ once attached; + on hover, and always on a phone, which has no hover. */}
      <span aria-hidden className={`absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-[5px] text-[18px] font-bold leading-none ${on
        ? "bg-accent text-white"
        : "bg-surface text-accent ring-1 ring-[var(--border)] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-visible:opacity-100"}`}>{on ? "✓" : "+"}</span>
      <span className={`mt-1 block truncate text-[16px] ${on ? "text-muted" : ""}`}>{name}</span>
    </button>
  );
}

/** What is attached, then the task's files to add from. */
export function EmailAttachments({ attached, taskItems, thumbs, onRemove, onToggle, onOpen }: {
  attached: Attachment[];
  taskItems?: Attachment[];
  thumbs: Record<string, string>;
  onRemove: (a: Attachment) => void;
  /** Attach a task file, or take it off when it is attached. */
  onToggle?: (a: Attachment) => void;
  onOpen?: (a: Attachment) => void;
}) {
  const choices = onToggle ? taskAttachChoices(taskItems, attached) : [];
  const urlOf = (a: Attachment) => (canShowPicture(a) ? thumbs[a.path!] : undefined);
  return (
    <>
      {attached.length > 0 && (
        <div className={`mt-2 ${thumbGrid}`}>
          {attached.map((a) => (
            <AttachedThumb key={a.id} a={a} url={urlOf(a)} onRemove={() => onRemove(a)} onOpen={onOpen && urlOf(a) ? () => onOpen(a) : undefined} />
          ))}
        </div>
      )}
      {choices.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <p className="text-[16px] font-semibold text-muted">Add from this task</p>
          <div className={`mt-1.5 ${thumbGrid}`}>
            {choices.map(({ item, state }) => (
              <ChoiceThumb key={item.id} a={item} url={urlOf(item)} state={state} onToggle={() => onToggle!(item)} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
