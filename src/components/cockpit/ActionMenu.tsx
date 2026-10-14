"use client";

// A button that opens a short list of actions, closed by picking one, clicking
// away or Escape. Keeps a review's toolbar to a few buttons, with the rarer and
// riskier actions (Remove this version) one click further in (Derek, 2026-09-13:
// "how can we clean this up it's a little messy").
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { quietButton } from "./TaskWorkItem";
import { useEscapeToClose } from "./useEscapeToClose";
import { menuPos } from "./ui";

/** divider: a thin line above the item, to group a long menu. */
export type ActionMenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; divider?: boolean };

/** On a phone a menu opens as a sheet at the bottom of the screen, like the
 *  client page's Contact sheet (2026-10-14): an anchored menu ran off the
 *  edge at 375px. Drawn below sm only; the backdrop closes it. */
export function MenuSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sm:hidden">
      <div className="fixed inset-0 z-[120] bg-black/30" onClick={onClose} />
      <div role="menu" aria-label={label}
        className="fixed inset-x-3 bottom-3 z-[121] max-h-[75vh] overflow-y-auto rounded-[5px] bg-surface p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))] text-foreground shadow-[var(--shadow-md)] ring-1 ring-[var(--border)]">
        {children}
      </div>
    </div>
  );
}

/** A whole screen page on a phone (Derek, 2026-10-14: + Add step had no room
 *  as a sheet): white, the full height, scrolling inside, with a back line at
 *  the top that scrolls with it (never sticky). Nothing is focused when it
 *  opens, so no keyboard or AutoFill bar comes up; the page itself takes the
 *  focus. Below sm only; Escape and the back line close it. */
export function PhonePage({ label, back, title, onClose, children }: { label: string; back: string; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  useEscapeToClose(onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      className="fixed inset-0 z-[120] overflow-y-auto overscroll-contain bg-surface text-foreground outline-none sm:hidden">
      <div className="flex min-h-full flex-col gap-3 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button onClick={onClose} className="-ml-2 inline-flex h-10 min-w-0 max-w-full items-center gap-1.5 self-start rounded-[5px] px-2 text-[16px] font-medium text-muted hover:bg-background hover:text-foreground">
          <span aria-hidden>←</span><span className="min-w-0 truncate">{back}</span>
        </button>
        <h2 className="text-[24px] font-bold leading-tight">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ActionMenu({ label, title, items, triggerClassName = quietButton, sheet = false }: {
  label: ReactNode;
  /** Said by screen readers and shown on hover. */
  title: string;
  /** The button's look: a bordered quiet button unless given (a comment's ⋯ is a plain icon). */
  triggerClassName?: string;
  /** Leave an item out with false or null. */
  items: (ActionMenuItem | false | null | undefined)[];
  /** On a phone, open as a sheet at the bottom (MenuSheet), not anchored. */
  sheet?: boolean;
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
    if (!open || !m || !m.width) return;
    const left = Math.max(8, Math.min(pos.left, window.innerWidth - m.width - 8));
    const top = Math.max(8, Math.min(pos.top, window.innerHeight - m.height - 8));
    if (left !== pos.left || top !== pos.top) setPos({ top, left });
  }, [open, pos]);
  if (!shown.length) return null;
  const toggle = () => {
    if (!open) setPos(menuPos(triggerRef, 220, shown.length * 40 + 14));
    setOpen((o) => !o);
  };
  const itemButton = (item: ActionMenuItem, i: number) => (
    <div key={item.label} className={item.divider && i > 0 ? "mt-1 border-t pt-1" : undefined}>
      <button role="menuitem" disabled={item.disabled}
        onClick={() => { setOpen(false); item.onClick(); }}
        className={`block w-full rounded-md px-3 py-2 text-left text-[16px] hover:bg-background disabled:opacity-50 ${item.danger ? "text-danger" : ""}`}>
        {item.label}
      </button>
    </div>
  );
  return (
    <div className="relative">
      <button ref={triggerRef} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={title} title={title} className={triggerClassName}>
        {label}
      </button>
      {open && (
        <>
          <div className={`fixed inset-0 z-30 ${sheet ? "hidden sm:block" : ""}`} onClick={() => setOpen(false)} />
          <div ref={menuRef} role="menu" style={{ position: "fixed", top: pos.top, left: pos.left, maxWidth: "calc(100vw - 16px)" }}
            className={`z-40 min-w-[220px] rounded-lg border bg-surface p-1.5 shadow-lg ${sheet ? "hidden sm:block" : ""}`}>
            {shown.map(itemButton)}
          </div>
          {sheet && <MenuSheet label={title} onClose={() => setOpen(false)}>{shown.map(itemButton)}</MenuSheet>}
        </>
      )}
    </div>
  );
}
