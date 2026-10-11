"use client";

// A small "Feedback" tab on the right edge (Derek, 2026-10-11): a teammate
// clicks it, types what they noticed, and it lands as a comment on one task,
// "Team feedback on ClickUpTasks" in CUL Tasks, with the task or page they
// were on. Drag the tab up or down if it is in the way; the spot is remembered
// per browser.
import { useRef, useState } from "react";
import { usePersisted } from "@/lib/usePersisted";

export const FEEDBACK_TASK_ID = "t_yhveqva5";

export function FeedbackTab({ where, onSend }: {
  where: string;
  onSend: (body: string) => void;
}) {
  const [savedTop, saveTop] = usePersisted("feedbackTabTop", 60, (v) => typeof v === "number" && v > 0 && v < 100);
  const [dragTop, setDragTop] = useState<number | null>(null);
  const top = dragTop ?? savedTop;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const drag = useRef<{ y: number; top: number; moved: boolean } | null>(null);

  const topAt = (d: { y: number; top: number }, y: number) => Math.min(92, Math.max(8, d.top + ((y - d.y) / window.innerHeight) * 100));
  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    drag.current = { y: e.clientY, top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (Math.abs(e.clientY - d.y) > 4) d.moved = true;
    if (d.moved) setDragTop(topAt(d, e.clientY));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.moved) { saveTop(Math.round(topAt(d, e.clientY))); setDragTop(null); return; }
    setOpen((o) => !o);
  };
  const send = () => {
    if (!text.trim()) return;
    onSend(`${text.trim()}\n\n(From the Feedback tab, on ${where})`);
    setText(""); setOpen(false);
  };

  return (
    <div className="fixed right-0 z-[90] flex items-start" style={{ top: `${top}%`, transform: "translateY(-50%)" }}>
      {open && (
        <div className="mr-1 w-[300px] max-w-[calc(100vw-48px)] rounded-[5px] border bg-surface p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[16px] font-semibold">Feedback</span>
            <button onClick={() => setOpen(false)} aria-label="Close feedback" className="rounded px-1.5 text-[16px] text-muted hover:bg-background">×</button>
          </div>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
            placeholder="What's working, what's broken, what you'd change…"
            className="mt-2 w-full rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
          <div className="mt-1 truncate text-[16px] text-muted">On {where}</div>
          <div className="mt-2 flex justify-end">
            <button onClick={send} disabled={!text.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Send</button>
          </div>
        </div>
      )}
      <button onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}
        title="Send feedback (drag to move)" aria-label="Send feedback"
        className="touch-none select-none rounded-l-[5px] bg-accent text-[13px] font-semibold leading-none tracking-wide text-white opacity-80 shadow-md hover:opacity-100"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", cursor: "grab", padding: "12px 4px" }}>
        Feedback
      </button>
    </div>
  );
}
