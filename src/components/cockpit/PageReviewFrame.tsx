"use client";

// A web page review's page, shown safely: a sandboxed iframe (scripts only, no
// same origin, forms, popups or top navigation) at /page-frame/[ticket], which is
// sandboxed again by its own CSP header. Shared by the team's window and the
// client's review page (Derek, 2026-09-12: web page review).
//
// Everything the frame sends is checked by readFrameMessage before it is used.
// What goes in is only ids, numbers, spots and text the page already holds. The
// toolbar picks the mode (Comment, Edit text, Try the page) and the width the page
// is laid out at (Desktop 1280px, Mobile 390px); the frame opens up to the page's
// height and zooms to its content. The other side is public/page-bridge.js.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { readFrameMessage, type ContentSpan, type FrameMode, type FramePin, type PageEdit } from "@/lib/pageFrameProtocol";
import type { PinAnchor } from "@/lib/reviewPins";

// maxZoom: how far a page with narrow content (an email) is zoomed in to fill the
// box. A phone view stays at its own size.
export const PAGE_DEVICES = {
  desktop: { label: "Desktop", width: 1280, height: 860, maxZoom: 1.5 },
  mobile: { label: "Mobile", width: 390, height: 844, maxZoom: 1 },
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

// The frame opens up to the page's full height instead of scrolling inside a
// fixed box (Derek, 2026-09-12: "a long email with too much scroll can we make it
// frame open up"), between these heights. A page whose height follows the frame's
// own (a section set to the full screen height) would grow for ever, so after a
// run of quick growth spurts the frame stops following it and scrolls inside.
const MIN_FRAME_HEIGHT = 480;
const MAX_FRAME_HEIGHT = 20_000;
const GROWTH_SPURTS = 6;
const SPURT_MS = 1500;
// The page's own background kept beside its content when zoomed in on it.
const CONTENT_MARGIN = 24;
const sameSpan = (a: ContentSpan | null, b: ContentSpan | null) => a === b || (!!a && !!b && a.left === b.left && a.right === b.right);

export function PageReviewFrame({ frameUrl, onReload, mode, onMode, device, onDevice, canEdit, canComment, pins, pending, focus, edits, onPlace, onPinClick, onEdit, actions, color }: {
  /** Buttons at the right end of the toolbar (the team's New version and More menus). */
  actions?: ReactNode;
  /** The chosen toolbar buttons' colour (the client page's navy); the app's own look without it. */
  color?: string;
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
  // The page's own height as the frame last reported it, and how fast it has been growing.
  const [measured, setMeasured] = useState<{ url: string | null; height: number; span: ContentSpan | null } | null>(null);
  const growth = useRef({ url: null as string | null, height: 0, spurts: 0, at: 0, frozen: false });
  // A spot marked in the scaled frame for scrolling a pin into view, and the scale to place it with.
  const pinMark = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);

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
      } else if (message.type === "size") {
        const now = Date.now();
        const g = growth.current.url === l.frameUrl ? growth.current : (growth.current = { url: l.frameUrl, height: 0, spurts: 0, at: 0, frozen: false });
        if (!g.frozen && message.height > g.height) {
          g.spurts = g.height && now - g.at < SPURT_MS ? g.spurts + 1 : 1;
          g.at = now;
          if (g.spurts > GROWTH_SPURTS) g.frozen = true;
        }
        if (!g.frozen) g.height = message.height;
        const next = { url: l.frameUrl, height: g.height, span: message.span };
        setMeasured((m) => (m && m.url === next.url && m.height === next.height && sameSpan(m.span, next.span) ? m : next));
      } else if (message.type === "focus-at") {
        const mark = pinMark.current;
        if (!mark) return;
        mark.style.top = `${message.y * scaleRef.current}px`;
        mark.scrollIntoView({ block: "center", behavior: "smooth" });
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
  const report = measured && measured.url === frameUrl ? measured : null;
  // The whole page scaled to fit, or, when its content is narrower (an email in a
  // wide page), zoomed in on the content and centred on it.
  const fit = available ? Math.min(1, available / size.width) : 1;
  let scale = fit;
  let shift = 0;
  if (report?.span && available) {
    const left = Math.max(0, report.span.left - CONTENT_MARGIN);
    const right = Math.min(size.width, report.span.right + CONTENT_MARGIN);
    const zoom = right > left ? Math.min(size.maxZoom, available / (right - left)) : fit;
    if (zoom > fit * 1.05) {
      scale = zoom;
      const shown = Math.min(available, size.width * scale);
      shift = Math.min(0, Math.max(shown - size.width * scale, (shown - (left + right) * scale) / 2));
    }
  }
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  const pageHeight = report ? report.height : size.height;
  const frameHeight = Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, pageHeight));
  const modes = MODES.filter((m) => (m.mode === "edit" ? canEdit : m.mode === "comment" ? canComment : true));
  const current = modes.find((m) => m.mode === mode) ?? modes[modes.length - 1];
  const segment = (active: boolean) =>
    `rounded-full px-3 py-1 text-[16px] font-medium transition ${active ? (color ? "text-white" : "bg-foreground text-background") : "text-muted hover:text-foreground"}`;
  const segmentStyle = (active: boolean) => (active && color ? { background: color } : undefined);

  return (
    <div ref={box} className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="What a click does" className="flex flex-wrap gap-1 rounded-full border bg-surface p-1">
          {modes.map((m) => (
            <button key={m.mode} role="radio" aria-checked={current.mode === m.mode} onClick={() => onMode(m.mode)} className={segment(current.mode === m.mode)} style={segmentStyle(current.mode === m.mode)}>{m.label}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Page width" className="flex gap-1 rounded-full border bg-surface p-1">
            {(Object.keys(PAGE_DEVICES) as PageDevice[]).map((d) => (
              <button key={d} role="radio" aria-checked={device === d} onClick={() => onDevice(d)} className={segment(device === d)} style={segmentStyle(device === d)}>{PAGE_DEVICES[d].label}</button>
            ))}
          </div>
          {actions}
        </div>
      </div>
      <p className="mb-2 text-[16px] text-muted" aria-live="polite">{notice ?? current.hint}</p>
      <div className="relative mx-auto overflow-hidden rounded-lg border bg-white shadow-sm" style={{ width: Math.min(available || Infinity, size.width * scale), height: frameHeight * scale }}>
        <div ref={pinMark} aria-hidden className="pointer-events-none absolute left-0 h-px w-px" style={{ top: 0 }} />
        {frameUrl ? (
          <iframe key={frameUrl} ref={frame} src={frameUrl} title="The page under review" sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={onLoad}
            style={{ width: size.width, height: frameHeight, border: 0, transform: `translateX(${shift}px) scale(${scale})`, transformOrigin: "0 0", display: "block" }} />
        ) : (
          <p className="p-6 text-[16px] text-muted">Loading the page…</p>
        )}
      </div>
    </div>
  );
}
