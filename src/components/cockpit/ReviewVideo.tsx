"use client";
import { useCallback, useEffect, useRef, useState } from "react";

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
// Slice 1 only plays the video. Pausing to leave a comment at that second is the
// next slice (docs/video-review-plan.md), and this is where it will go.

export function ReviewVideo({ load, label, poster }: {
  /** A fresh link to the video, or null when there isn't one. */
  load: () => Promise<string | null>;
  /** What the video is called, read out to anyone who cannot see it. */
  label: string;
  poster?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
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
  }

  useEffect(() => {
    let cancelled = false;
    retried.current = false;
    resumeAt.current = 0;
    void load().then((fresh) => {
      if (cancelled) return;
      setUrl(fresh);
      setFailed(!fresh);
    });
    return () => { cancelled = true; };
  }, [load]);

  // A link that ran out: take one fresh one and pick the video up where it was.
  const onError = () => {
    if (retried.current) { setFailed(true); return; }
    retried.current = true;
    resumeAt.current = video.current?.currentTime ?? 0;
    void load().then((fresh) => {
      if (fresh) setUrl(fresh);
      else setFailed(true);
    });
  };

  const onLoaded = () => {
    const el = video.current;
    if (el && resumeAt.current > 0 && resumeAt.current < el.duration) {
      el.currentTime = resumeAt.current;
      resumeAt.current = 0;
    }
  };

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
  return (
    <video ref={video} src={url} poster={poster} controls playsInline preload="metadata"
      aria-label={label} onError={onError} onLoadedMetadata={onLoaded}
      className="w-full rounded-2xl bg-black shadow-sm" style={{ maxHeight: "72dvh" }} />
  );
}

/** One version's video, with its link callback bound to that file, so the player
 *  only reloads when the file it shows actually changes. */
export function VideoVersion({ fileId, label, load }: {
  fileId: string;
  label: string;
  load: (fileId: string) => Promise<string | null>;
}) {
  const bound = useCallback(() => load(fileId), [load, fileId]);
  return <ReviewVideo load={bound} label={label} />;
}
