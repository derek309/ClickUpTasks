"use client";

// The step's thread on its page (Derek, 2026-10-17: a Message Michaella went,
// but nothing on the step showed it, so it read as not sent). Who wrote, the
// words and when, oldest first, the last five with the rest one click away.
// The Message box sits under it, at the foot of the step.
import { useState } from "react";
import { timeAgo } from "@/lib/data";
import type { ThreadLine } from "@/lib/stepThenNext";
import { CollapsibleText } from "./ui";

export const THREAD_SHOWN = 5;

export function StepThread({ lines }: { lines: ThreadLine[] }) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const hidden = all ? 0 : Math.max(0, lines.length - THREAD_SHOWN);
  return (
    <section aria-label="Messages on this step" className="flex flex-col gap-2">
      <h3 className="text-[16px] font-semibold">Messages</h3>
      {hidden > 0 && (
        <button onClick={() => setAll(true)} className="self-start text-[16px] font-semibold text-accent hover:underline">Show earlier ({hidden})</button>
      )}
      <ol className="flex flex-col gap-2">
        {lines.slice(hidden).map((l) => (
          <li key={l.id} className="rounded-[5px] bg-background px-3 py-2 text-[16px]">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{l.who}</span>
              <span className="text-muted">{timeAgo(l.at)}</span>
            </div>
            <CollapsibleText text={l.text} className="text-[16px]" maxLines={6} maxChars={500} />
          </li>
        ))}
      </ol>
    </section>
  );
}
