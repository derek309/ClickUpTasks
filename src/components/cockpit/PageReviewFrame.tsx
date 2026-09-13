"use client";

// A web page review's page, shown safely: a sandboxed iframe (scripts only, no
// same origin, forms, popups or top navigation) at /page-frame/[ticket], which is
// sandboxed again by its own CSP header. Shared by the team's window and the
// client's review page (Derek, 2026-09-12: web page review).
//
// Everything the frame sends is checked by readFrameMessage before it is used.
// What goes in is only ids, numbers, spots and text the page already holds. The
// toolbar picks the mode (Comment, Edit text, Try the page) and the width the page
// is laid out at (Desktop 1280px, Mobile 390px); the page is scaled to fit and
// scrolls inside the frame. The other side is public/page-bridge.js.
import { useEffect, useRef, useState } from "react";
import { readFrameMessage, type FrameMode, type FramePin, type PageEdit } from "@/lib/pageFrameProtocol";
import type { PinAnchor } from "@/lib/reviewPins";

export const PAGE_DEVICES = {
  desktop: { label: "Desktop", width: 1280, height: 860 },
  mobile: { label: "Mobile", width: 390, height: 844 },
} as const;
export type PageDevice = keyof typeof PAGE_DEVICES;
/** The device a pin was dropped at, to show the page at that width before focusing it. */
export const deviceForWidth = (width: number | null | undefined): PageDevice => (width != null && width < 800 ? "mobile" : "desktop");

const MODES: { mode: FrameMode; label: string; hint: string }[] = [
  { mode: "comment", label: "Comment", hint: "Click anywhere on the page to drop a numbered pin." },
  { mode: "edit", label: "Edit text", hint: "Click any text to change it. Press Enter to keep it." },
  { mode: "browse", label: "Try the page", hint: "Use the page like a visitor would. Links stay on this page." },
];

export type PagePlace = { x: number; y: number; anchor: PinAnchor | null };

export function PageReviewFrame({ frameUrl, onReload, mode, onMode, device, onDevice, canEdit, canComment, pins, pending, focus, edits, onPlace, onPinClick, onEdit }: {
  /** The frame's address, or null while it is being fetched. */
  frameUrl: string | null;
  /** Fetch a fresh frame address (the old one expired or the page navigated away). */
  onReload: () => void;
  mode: FrameMode;
  onMode: (mode: FrameMode) => void;
  device: PageDevice;
  onDevice: (device: PageDevice) => void;
  canEdit: boolean;
  canComment: boolean;
  pins: FramePin[];
  pending: (PagePlace & { number: number }) | null;
  /** A pin to scroll into view; n changes to ask again for the same pin. */
  focus: { id: string; n: number } | null;
  /** Rewording not sent yet, shown again whenever the frame loads. */
  edits: PageEdit[];
  onPlace: (place: PagePlace) => void;
  onPinClick: (id: string) => void;
  onEdit: (edit: PageEdit) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [available, setAvailable] = useState(0);
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ready = !!frameUrl && readyUrl === frameUrl;
  const loads = useRef<{ url: string | null; n: number }>({ url: null, n: 0 });
  const noticeTimer = useRef<number | null>(null);

  const say = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
  };
  const send = (message: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ cul: 1, ...message }, "*");

  // The handler reads the latest props, so it is added once.
  const latest = useRef({ frameUrl, mode, pins, pending, edits, onPlace, onPinClick, onEdit, canComment, canEdit });
  useEffect(() => { latest.current = { frameUrl, mode, pins, pending, edits, onPlace, onPinClick, onEdit, canComment, canEdit }; });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = readFrameMessage(event, frame.current?.contentWindow);
      if (!message) return;
      const l = latest.current;
      if (message.type === "ready") {
        setReadyUrl(l.frameUrl);
        send({ type: "mode", mode: l.mode });
        send({ type: "pins", pins: l.pins, pending: l.pending });
        if (l.edits.length) send({ type: "edits", edits: l.edits });
      } else if (message.type === "place") {
        if (l.canComment) l.onPlace({ x: message.x, y: message.y, anchor: message.anchor });
      } else if (message.type === "pin-click") {
        l.onPinClick(message.id);
      } else if (message.type === "edit") {
        if (l.canEdit) l.onEdit(message.edit);
      } else if (message.type === "not-editable") {
        say("This text comes from the page code. Leave a comment on it instead.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { if (ready) send({ type: "mode", mode }); }, [ready, mode]);
  const pinsKey = JSON.stringify([pins, pending]);
  useEffect(() => { if (ready) send({ type: "pins", pins, pending }); }, [ready, pinsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && focus) send({ type: "focus", id: focus.id }); }, [ready, focus]);

  // A frame that loads a second time was sent somewhere by the page's own code.
  const onLoad = () => {
    if (loads.current.url !== frameUrl) loads.current = { url: frameUrl, n: 0 };
    loads.current.n += 1;
    if (loads.current.n > 1) {
      loads.current = { url: null, n: 0 };
      say("The page tried to open another page, so we loaded it again.");
      onReload();
    }
  };

  const size = PAGE_DEVICES[device];
  const scale = available ? Math.min(1, available / size.width) : 1;
  const modes = MODES.filter((m) => (m.mode === "edit" ? canEdit : m.mode === "comment" ? canComment : true));
  const current = modes.find((m) => m.mode === mode) ?? modes[modes.length - 1];
  const segment = (active: boolean) =>
    `rounded-full px-3 py-1 text-[16px] font-medium transition ${active ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`;

  return (
    <div ref={box} className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="What a click does" className="flex flex-wrap gap-1 rounded-full border bg-surface p-1">
          {modes.map((m) => (
            <button key={m.mode} role="radio" aria-checked={current.mode === m.mode} onClick={() => onMode(m.mode)} className={segment(current.mode === m.mode)}>{m.label}</button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Page width" className="ml-auto flex gap-1 rounded-full border bg-surface p-1">
          {(Object.keys(PAGE_DEVICES) as PageDevice[]).map((d) => (
            <button key={d} role="radio" aria-checked={device === d} onClick={() => onDevice(d)} className={segment(device === d)}>{PAGE_DEVICES[d].label}</button>
          ))}
        </div>
      </div>
      <p className="mb-2 text-[16px] text-muted" aria-live="polite">{notice ?? current.hint}</p>
      <div className="mx-auto overflow-hidden rounded-lg border bg-white shadow-sm" style={{ width: size.width * scale, height: size.height * scale }}>
        {frameUrl ? (
          <iframe key={frameUrl} ref={frame} src={frameUrl} title="The page under review" sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={onLoad}
            style={{ width: size.width, height: size.height, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", display: "block" }} />
        ) : (
          <p className="p-6 text-[16px] text-muted">Loading the page…</p>
        )}
      </div>
    </div>
  );
}
