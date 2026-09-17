"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatPinTime } from "@/lib/reviewPins";

// The player a video review shows, on the team's drawer and on the client's page
// (Derek, 2026-09-17: the client watches a video he edited, pauses, and comments
// where they paused). Both sides ask for the link their own way, so the link comes
// in through `load`; everything about playing it is the same.
//
// The link is a signed storage link that lasts hours, and storage answers the byte
// ranges seeking asks for, so the app is not in the way of the watching. When a
// link does run out mid-watch the element errors: we fetch a fresh one once and
// carry on from the same second, so a long sitting never dead ends on a black box.
//
// A comment on a video marks a MOMENT, not a spot: there is nothing useful to
// point at in a moving picture, and the thing being talked about is "here, at
// 0:42". So the controls stay the browser's own, and the review parts sit around
// them: a strip of numbered markers under the scrubber, and, while paused, one
// button that starts a comment at that second.

/** A comment already on this video, at the second it was left at. */
export type VideoPin = { id: string; number: number; t: number; done: boolean; active: boolean };



export function ReviewVideo({ load, label, poster, pins = [], onPinClick, canComment, pending, onPlace, seekTo, color }: {
  /** A fresh link to the video, "cleared" once its file has been deleted 30 days
   *  after approval, or null when there isn't one. */
  load: () => Promise<string | "cleared" | null>;
  /** What the video is called, read out to anyone who cannot see it. */
  label: string;
  poster?: string;
  pins?: VideoPin[];
  onPinClick?: (id: string) => void;
  /** Whether pausing offers to start a comment at that second. */
  canComment?: boolean;
  /** The comment being written now, not saved yet. */
  pending?: { number: number; t: number } | null;
  onPlace?: (t: number) => void;
  /** The parent asking to jump to a second; the nonce lets the same second be
   *  asked for twice (clicking one comment in the rail again). */
  seekTo?: { t: number; nonce: number } | null;
  color?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [duration, setDuration] = useState(0);
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  // One retry per link: a second failure is the video, not the link running out.
  const retried = useRef(false);
  const resumeAt = useRef(0);

  // Pointed at another video: start over while rendering, so the old link is never
  // under the new video's controls for a frame (React's "adjust state when a prop
  // changes"). The effect below then fetches the new one.
  const [source, setSource] = useState(() => load);
  if (source !== load) {
    setSource(() => load);
    setUrl(null);
    setFailed(false);
    setCleared(false);
  }

  useEffect(() => {
    let cancelled = false;
    retried.current = false;
    resumeAt.current = 0;
    void load().then((fresh) => {
      if (cancelled) return;
      setCleared(fresh === "cleared");
      setUrl(fresh === "cleared" ? null : fresh);
      setFailed(!fresh);
    });
    return () => { cancelled = true; };
  }, [load]);

  // The rail asking to jump to a comment's moment. Pausing there too, because the
  // point of the jump is to look at that frame.
  useEffect(() => {
    const el = video.current;
    if (!el || !seekTo) return;
    el.pause();
    el.currentTime = Math.min(seekTo.t, el.duration || seekTo.t);
    setAt(el.currentTime);
  }, [seekTo?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link that ran out: take one fresh one and pick the video up where it was.
  const onError = () => {
    if (retried.current) { setFailed(true); return; }
    retried.current = true;
    resumeAt.current = video.current?.currentTime ?? 0;
    void load().then((fresh) => {
      if (fresh === "cleared") setCleared(true);
      else if (fresh) setUrl(fresh);
      else setFailed(true);
    });
  };

  const onLoaded = () => {
    const el = video.current;
    if (!el) return;
    setDuration(el.duration || 0);
    if (resumeAt.current > 0 && resumeAt.current < el.duration) {
      el.currentTime = resumeAt.current;
      resumeAt.current = 0;
    }
  };

  const seek = (t: number) => {
    const el = video.current;
    if (!el) return;
    el.pause();
    el.currentTime = Math.min(t, el.duration || t);
    setAt(el.currentTime);
  };

  if (cleared) {
    // The comments are still below this, and still worth reading, so the message
    // says the video went rather than that something is broken.
    return (
      <div className="rounded-2xl border bg-surface p-6 text-center">
        <p className="text-[18px] font-semibold">This video has been cleared.</p>
        <p className="mt-1 text-[16px] text-muted">We keep a video for 30 days after it is approved, then remove the file. Everything that was said about it is still here. Ask us if you need the video again.</p>
      </div>
    );
  }
  if (!failed && !url) {
    return <p className="py-10 text-center text-[16px] text-muted">Loading the video…</p>;
  }
  if (failed || !url) {
    return (
      <div className="rounded-2xl border bg-surface p-6 text-center">
        <p className="text-[18px] font-semibold">We couldn&apos;t load the video.</p>
        <p className="mt-1 text-[16px] text-muted">Please reload the page and try again.</p>
      </div>
    );
  }

  const marks = duration > 0 ? pins : [];
  const dot = "absolute top-1/2 flex h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-white px-1 text-[16px] font-bold leading-none text-white shadow-[0_2px_8px_rgba(0,0,0,0.35)]";

  return (
    <div>
      <video ref={video} src={url} poster={poster} controls playsInline preload="metadata"
        aria-label={label} onError={onError} onLoadedMetadata={onLoaded}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
        className="w-full rounded-2xl bg-black shadow-sm" style={{ maxHeight: "72dvh" }} />

      {/* The comments along the video, under the scrubber. The browser's own
          controls cannot carry markers, so they sit on a strip of their own at the
          same width, which also gives them room to be tapped on a phone. */}
      {(marks.length > 0 || pending) && (
        <div className="relative mt-2 h-9 rounded-full bg-background" aria-hidden={false}>
          {marks.map((p) => (
            <button key={p.id} onClick={() => { seek(p.t); onPinClick?.(p.id); }}
              title={`Comment ${p.number} at ${formatPinTime(p.t)}`} aria-label={`Comment ${p.number} at ${formatPinTime(p.t)}`}
              className={`${dot} transition hover:scale-110 ${p.active ? "z-10 scale-110 ring-4 ring-highlight/50" : ""} ${p.done ? "opacity-60" : ""}`}
              style={{ left: `${Math.min(100, (p.t / duration) * 100)}%`, background: p.done ? "#6b7280" : color ?? "#1b3a5c" }}>
              {p.number}
            </button>
          ))}
          {pending && duration > 0 && (
            <span aria-hidden className={`${dot} z-10 bg-surface ring-4 ring-highlight/40`}
              style={{ left: `${Math.min(100, (pending.t / duration) * 100)}%`, borderColor: color ?? "#1b3a5c", color: color ?? "#1b3a5c" }}>
              {pending.number}
            </span>
          )}
        </div>
      )}

      {/* Paused is the moment someone has something to say, so the offer is right
          there and names the second it would be pinned to. */}
      {canComment && onPlace && paused && !pending && (
        <button onClick={() => onPlace(Math.round(at * 10) / 10)}
          className="mt-2 min-h-[44px] rounded-xl px-4 text-[16px] font-semibold text-white"
          style={{ background: color ?? "#1b3a5c" }}>
          Comment at {formatPinTime(at)}
        </button>
      )}
    </div>
  );
}

/** One version's video, with its link callback bound to that file, so the player
 *  only reloads when the file it shows actually changes. */
export function VideoVersion({ fileId, label, load, ...rest }: {
  fileId: string;
  label: string;
  load: (fileId: string) => Promise<string | null>;
} & Omit<Parameters<typeof ReviewVideo>[0], "load" | "label">) {
  const bound = useCallback(() => load(fileId), [load, fileId]);
  return <ReviewVideo load={bound} label={label} {...rest} />;
}
