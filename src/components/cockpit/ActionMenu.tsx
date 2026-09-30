"use client";

// A button that opens a short list of actions, closed by picking one, clicking
// away or Escape. Keeps a review's toolbar to a few buttons, with the rarer and
// riskier actions (Remove this version) one click further in (Derek, 2026-09-13:
// "how can we clean this up it's a little messy").
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { quietButton } from "./TaskWorkItem";
import { useEscapeToClose } from "./useEscapeToClose";
import { menuPos } from "./ui";

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
  // Fixed to the screen, off the trigger's own position, rather than absolute
  // under it: on the follow up card the menu opened inside a rounded card that
  // clips its contents, and all you saw was its top edge (Derek, 2026-09-30:
  // "the dropdown is popping underneath"). Same fix the list's dropdowns use.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  // Escape closes only the menu, not the review window or drawer under it.
  useEscapeToClose(() => setOpen(false), open);
  const shown = items.filter((item): item is ActionMenuItem => !!item);
  // The first guess assumes the narrowest menu. Once it is on screen its real
  // size is known, so pull it back in if a long label ran it off an edge.
  useLayoutEffect(() => {
    const m = menuRef.current?.getBoundingClientRect();
    if (!open || !m) return;
    const left = Math.max(8, Math.min(pos.left, window.innerWidth - m.width - 8));
    const top = Math.max(8, Math.min(pos.top, window.innerHeight - m.height - 8));
    if (left !== pos.left || top !== pos.top) setPos({ top, left });
  }, [open, pos]);
  if (!shown.length) return null;
  const toggle = () => {
    if (!open) setPos(menuPos(triggerRef, 220, shown.length * 40 + 14));
    setOpen((o) => !o);
  };
  return (
    <div className="relative">
      <button ref={triggerRef} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={title} title={title} className={triggerClassName}>
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div ref={menuRef} role="menu" style={{ position: "fixed", top: pos.top, left: pos.left, maxWidth: "calc(100vw - 16px)" }}
            className="z-40 min-w-[220px] rounded-lg border bg-surface p-1.5 shadow-lg">
            {shown.map((item) => (
              <button key={item.label} role="menuitem" disabled={item.disabled}
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`block w-full rounded-md px-3 py-2 text-left text-[16px] hover:bg-background disabled:opacity-50 ${item.danger ? "text-danger" : ""}`}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
