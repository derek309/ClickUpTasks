"use client";

// ＋ Add ▾ on a step (Derek, 2026-10-17, step-done-then-next-mockup.html):
// one word under what the step uses, its menu holding everything a step can
// take. Checklist and Description first while the step has neither (each
// goes once the step has it), then Link and Attach a file, Make to review
// (Document, Image, HTML review, Video), Talk to the client (Text, Chat in
// the portal, Meet), then Make it a task and Transcript. Pasting a link or
// dropping a file anywhere on the page still adds it here. The app's own
// icons, no emoji. On a phone it opens as a sheet at the bottom.
import { useState } from "react";
import { I } from "./ui";
import { ADD_ICON } from "./StepSetup";
import { MenuSheet } from "./ActionMenu";
import { useEscapeToClose } from "./useEscapeToClose";

export type OnStepOption = { key: string; label: string; note?: string; disabled?: boolean; onPick: () => void };

const MAKE = ["doc", "image", "page", "page:email", "page:page", "video"];
const TALK = ["email", "text", "chat", "meetnow"];
const AFTER = ["maketask", "transcript"];
/** Kept out of the groups: Checklist and Description lead the menu, and Claude is a turn, not a thing to add. */
const NOT_IN_MENU = new Set(["directions", "description", "checklist", "claude", "links"]);
const SHORT: Record<string, string> = { text: "Text", chat: "Chat in the portal", meetnow: "Meet", maketask: "Make it a task", transcript: "Transcript", email: "Email" };
const icon = (key: string) => key === "meetnow" ? I.calendar : key === "maketask" ? I.copy : key === "transcript" ? I.clipboard : key === "links" ? I.clip : ADD_ICON[key];

/** The ＋ Add menu's items in its groups: what isn't in a group goes last. */
export function addMenuGroups(options: OnStepOption[], first: string) {
  const items = options.filter((o) => !NOT_IN_MENU.has(o.key));
  const pick = (keys: string[]) => keys.flatMap((k) => items.filter((o) => o.key === k));
  const known = new Set([...MAKE, ...TALK, ...AFTER]);
  return [
    { label: "Make to review", items: pick(MAKE) },
    { label: `Talk to ${first}`, items: pick(TALK) },
    { label: null, items: [...pick(AFTER), ...items.filter((o) => !known.has(o.key))] },
  ].filter((g) => g.items.length > 0);
}

export function OnThisStep({ first, options, onDescription, onChecklist, onLink, onAttach, lead = [], hint }: {
  first: string;
  /** The step's Add items (TaskDrawer addOptionsFor): sorted into the menu's groups here. */
  options: OnStepOption[];
  /** Missing when the step has one already (or can't take one). */
  onDescription?: () => void;
  onChecklist?: () => void;
  /** Link and Attach a file, after Checklist and Description. */
  onLink?: () => void;
  onAttach?: () => void;
  /** What the step's name suggests ("Write the document"), first in the
   *  menu (off for now: STEP_SUGGESTIONS_ON). */
  lead?: { key: string; label: string; onPick: () => void }[];
  /** Quiet words beside it on a wider screen: "email, doc, image, page, video". */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  // Escape closes the menu, not the step page under it.
  useEscapeToClose(() => setOpen(false), open);
  const write: OnStepOption[] = [
    ...lead.map((x) => ({ key: `lead:${x.key}`, label: x.label, onPick: x.onPick })),
    ...(onChecklist ? [{ key: "checklist", label: "Checklist", onPick: onChecklist }] : []),
    ...(onDescription ? [{ key: "description", label: "Description", onPick: onDescription }] : []),
  ];
  const attach: OnStepOption[] = [
    ...(onLink ? [{ key: "link", label: "Link", onPick: onLink }] : []),
    ...(onAttach ? [{ key: "attach", label: "Attach a file", onPick: onAttach }] : []),
  ];
  const groups = [
    ...(write.length ? [{ label: null as string | null, items: write }] : []),
    ...(attach.length ? [{ label: null as string | null, items: attach }] : []),
    ...addMenuGroups(options, first),
  ];
  const word = "inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-1 text-[16px] font-semibold text-accent hover:bg-background";
  const ICONS: Record<string, typeof I.link | undefined> = { link: I.link, attach: I.clip, description: I.clipboard, checklist: I.check };
  const item = (o: OnStepOption) => {
    const Icon = ICONS[o.key] ?? icon(o.key);
    return (
      <button key={o.key} role="menuitem" disabled={o.disabled} onClick={() => { setOpen(false); o.onPick(); }}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[16px] hover:bg-background disabled:opacity-50">
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted" /> : <span className="w-4 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate">{SHORT[o.key] && !o.note ? SHORT[o.key] : o.label}</span>
          {o.key === "maketask" && <span className="block text-muted">A new task with this email as step 1, linked back</span>}
        </span>
        {o.note && o.key !== "maketask" && <span className="shrink-0 truncate text-muted">{o.note}</span>}
      </button>
    );
  };
  const menu = groups.map((g, i) => (
    <div key={g.label ?? `g${i}`} className={i > 0 ? "mt-1 border-t pt-1" : undefined}>
      {g.label && <div className="px-2.5 pb-0.5 pt-1.5 text-[16px] text-muted">{g.label}</div>}
      {g.items.map(item)}
    </div>
  ));
  if (!groups.length) return null;
  return (
    <div role="group" aria-label="Add to this step" className="flex min-w-0 flex-nowrap items-center gap-x-2">
      <span className="relative shrink-0">
        <button aria-haspopup="menu" aria-expanded={open} title="Add to this step"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const w = Math.min(300, window.innerWidth - 16);
            const h = Math.min(window.innerHeight - 16, groups.reduce((n, g) => n + g.items.length * 44 + (g.label ? 32 : 8), 14));
            setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4 });
            setOpen((o) => !o);
          }} className={word}><I.plus className="h-4 w-4" />Add ▾</button>
        {open && (<>
          <div className="fixed inset-0 z-30 hidden sm:block" onClick={() => setOpen(false)} />
          <div role="menu" aria-label="Add to this step" style={{ top: pos.top, left: pos.left }}
            className="fixed z-40 hidden max-h-[calc(100vh-16px)] w-[min(300px,calc(100vw-16px))] overflow-y-auto rounded-[5px] border bg-surface p-1.5 shadow-lg sm:block">{menu}</div>
          <MenuSheet label="Add to this step" onClose={() => setOpen(false)}>{menu}</MenuSheet>
        </>)}
      </span>
      {hint && <span className="min-w-0 truncate text-[16px] text-muted max-sm:hidden">{hint}</span>}
    </div>
  );
}
