"use client";

// A small "Feedback" tab on the right edge (Derek, 2026-10-11): a teammate
// clicks it, types what they noticed, and it lands as a comment on one task,
// "Team feedback on ClickUpTasks" in CUL Tasks, with the task or page they
// were on. Drag the tab up, down or to the other edge if it is in the way (the
// spot is remembered per browser); its × hides it until the page reloads.
// A screenshot goes with it (Derek, 2026-10-12): 📸 takes one of the page,
// or paste or drop an image in.
import { useEffect, useRef, useState } from "react";
import { usePersisted } from "@/lib/usePersisted";

export const FEEDBACK_TASK_ID = "t_yhveqva5";

// On a phone the tab is gone (Derek, 2026-10-14): it sat over the page's
// right edge. "Send feedback" in the menu opens the box there instead, as a
// sheet at the bottom (openNonce).
export function FeedbackTab({ where, onSend, openNonce = 0 }: {
  where: string;
  onSend: (body: string, images: File[]) => void;
  /** Opens the box when it changes (the phone menu's Send feedback). */
  openNonce?: number;
}) {
  const [savedTop, saveTop] = usePersisted("feedbackTabTop", 60, (v) => typeof v === "number" && v > 0 && v < 100);
  const [side, saveSide] = usePersisted<"left" | "right">("feedbackTabSide", "right", (v) => v === "left" || v === "right");
  const [dragAt, setDragAt] = useState<{ top: number; x: number } | null>(null);
  const top = dragAt?.top ?? savedTop;
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [seenNonce, setSeenNonce] = useState(openNonce);
  if (openNonce !== seenNonce) {
    setSeenNonce(openNonce);
    if (openNonce) { setOpen(true); setHidden(false); }
  }
  const [text, setText] = useState("");
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);
  const [capturing, setCapturing] = useState(false);
  const addShot = (file: File) => setShots((s) => [...s, { file, url: URL.createObjectURL(file) }].slice(0, 5));
  useEffect(() => () => shots.forEach((x) => URL.revokeObjectURL(x.url)), []); // eslint-disable-line react-hooks/exhaustive-deps
  // The page as it looks, without this box in the way: the browser asks
  // which tab or screen once, one frame is kept, sharing stops at once.
  const takeScreenshot = async () => {
    const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (o: object) => Promise<MediaStream> };
    if (!md?.getDisplayMedia) return;
    setCapturing(true);
    try {
      const stream = await md.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" });
      const video = document.createElement("video");
      video.srcObject = stream; video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 300));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (blob) addShot(new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" }));
    } catch { /* cancelled */ }
    finally { setCapturing(false); }
  };
  const drag = useRef<{ x: number; y: number; top: number; moved: boolean } | null>(null);

  const topAt = (d: { y: number; top: number }, y: number) => Math.min(92, Math.max(8, d.top + ((y - d.y) / window.innerHeight) * 100));
  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, top, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (Math.abs(e.clientY - d.y) > 4 || Math.abs(e.clientX - d.x) > 4) d.moved = true;
    if (d.moved) setDragAt({ top: topAt(d, e.clientY), x: e.clientX });
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.moved) {
      saveTop(Math.round(topAt(d, e.clientY)));
      saveSide(e.clientX < window.innerWidth / 2 ? "left" : "right");
      setDragAt(null); return;
    }
    setOpen((o) => !o);
  };
  const send = () => {
    if (!text.trim()) return;
    onSend(`${text.trim()}\n\n(From the Feedback tab, on ${where})`, shots.map((x) => x.file));
    shots.forEach((x) => URL.revokeObjectURL(x.url));
    setText(""); setShots([]); setOpen(false);
  };

  if (hidden) return null;
  const left = side === "left";
  // While dragging it follows the pointer; let go and it settles on the nearer edge.
  const place: React.CSSProperties = dragAt
    ? { left: Math.min(window.innerWidth - 24, Math.max(0, dragAt.x - 11)) }
    : left ? { left: 0 } : { right: 0 };
  const panelBox = (phone: boolean) => (
    <div className={phone ? "w-full rounded-[5px] border bg-surface p-3 shadow-lg" : `${left ? "ml-1" : "mr-1"} w-[300px] max-w-[calc(100vw-48px)] rounded-[5px] border bg-surface p-3 shadow-lg`}>
      <div className="flex items-center justify-between">
        <span className="text-[16px] font-semibold">Feedback</span>
        <button onClick={() => setOpen(false)} aria-label="Close feedback" className="rounded px-1.5 text-[16px] text-muted hover:bg-background">×</button>
      </div>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4}
        onPaste={(e) => { const f = [...e.clipboardData.files].filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); f.forEach(addShot); } }}
        onDrop={(e) => { const f = [...e.dataTransfer.files].filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); f.forEach(addShot); } }}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
        placeholder="What's working, what's broken, what you'd change…"
        className="mt-2 w-full rounded-md border bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-accent" />
      {shots.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {shots.map((x, i) => (
            <span key={x.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={x.url} alt={`Screenshot ${i + 1}`} className="h-14 w-20 rounded-[5px] border object-cover" />
              <button onClick={() => { URL.revokeObjectURL(x.url); setShots((s) => s.filter((y) => y.url !== x.url)); }} aria-label="Remove screenshot"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[12px] text-[color:var(--surface)]">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 truncate text-[16px] text-muted">On {where}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button onClick={() => void takeScreenshot()} title="Take a screenshot of this page (or paste one)" className="rounded-md border px-2.5 py-1.5 text-[16px] font-medium hover:bg-background">📸 Screenshot</button>
        <button onClick={send} disabled={!text.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[16px] font-medium text-white disabled:opacity-40">Send</button>
      </div>
    </div>
  );
  const panel = open && !capturing && panelBox(false);
  const tab = (
    <div className="group relative">
      <button onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setDragAt(null); }}
        title="Send feedback (drag to move)" aria-label="Send feedback"
        className="block touch-none select-none bg-accent text-[13px] font-semibold leading-none tracking-wide text-white opacity-80 shadow-md hover:opacity-100"
        // Turned 180° so it reads bottom to top, which flips its corners too:
        // round the side that ends up facing the page.
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", cursor: dragAt ? "grabbing" : "grab", padding: "12px 4px", borderRadius: left ? "5px 0 0 5px" : "0 5px 5px 0" }}>
        Feedback
      </button>
      <button onClick={() => setHidden(true)} title="Hide until the page reloads" aria-label="Hide the feedback tab"
        className={`absolute -top-2 ${left ? "-right-2" : "-left-2"} hidden h-4 w-4 items-center justify-center rounded-full bg-foreground text-[11px] leading-none text-[color:var(--surface)] group-hover:flex`}>×</button>
    </div>
  );
  return (<>
    <div className="fixed z-[90] hidden items-start sm:flex" style={{ top: `${top}%`, transform: "translateY(-50%)", ...place }}>
      {left ? <>{tab}{panel}</> : <>{panel}{tab}</>}
    </div>
    {open && !capturing && (
      <div className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-[90] sm:hidden">{panelBox(true)}</div>
    )}
  </>);
}
