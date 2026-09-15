"use client";

// A button that opens a short list of actions, closed by picking one, clicking
// away or Escape. Keeps a review's toolbar to a few buttons, with the rarer and
// riskier actions (Remove this version) one click further in (Derek, 2026-09-13:
// "how can we clean this up it's a little messy").
import { useState, type ReactNode } from "react";
import { quietButton } from "./TaskWorkItem";
import { useEscapeToClose } from "./useEscapeToClose";

export type ActionMenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };

export function ActionMenu({ label, title, items, triggerClassName = quietButton }: {
  label: ReactNode;
  /** Said by screen readers and shown on hover. */
  title: string;
  /** The button's look: a bordered quiet button unless given (a comment's ⋯ is a plain icon). */
  triggerClassName?: string;
  /** Leave an item out with false or null. */
  items: (ActionMenuItem | false | null | undefined)[];
}) {
  const [open, setOpen] = useState(false);
  // Escape closes only the menu, not the review window or drawer under it.
  useEscapeToClose(() => setOpen(false), open);
  const shown = items.filter((item): item is ActionMenuItem => !!item);
  if (!shown.length) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={title} title={title} className={triggerClassName}>
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-40 mt-1 min-w-[220px] rounded-lg border bg-surface p-1.5 shadow-lg">
            {shown.map((item) => (
              <button key={item.label} role="menuitem" disabled={item.disabled}
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`block w-full whitespace-nowrap rounded-md px-3 py-2 text-left text-[16px] hover:bg-background disabled:opacity-50 ${item.danger ? "text-danger" : ""}`}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
