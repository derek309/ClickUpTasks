"use client";

// ✨ Write it for me (Derek, 2026-10-17, AI in steps idea 3): on a client's
// step, Claude writes "What we need from <First>" (the step's description:
// the words the portal's orange box and the reminders use) and the email
// asking for it, short, one ask, no sign off. Pressed, both go into the
// editable fields; nothing is sent. On a client's step with no description
// and no email yet it is offered on its own, as a suggestion line to take or
// leave, never by filling the fields.
import { useEffect, useState } from "react";
import { offersAskOnItsOwn, type AiAsk3 } from "@/lib/aiSteps";
import type { Subtask } from "@/lib/data";
import { AI_BOX, AI_LABEL } from "./AiEmailBox";

export function AiAskBox({ step, first, emailWritten, read, onCache, onFill }: {
  step: Subtask;
  first: string;
  /** The step's email to the client has words in it already. */
  emailWritten: boolean;
  /** Asks Claude: the ask, "off" when AI in steps is off, null when it failed. */
  read: () => Promise<AiAsk3 | "off" | null>;
  /** Keeps the suggestion on the step (aiAsk), or hides it (dismissed). */
  onCache: (a: Subtask["aiAsk"]) => void;
  /** Puts it in the description and the email draft, to edit and send. */
  onFill: (a: AiAsk3) => void;
}) {
  const own = offersAskOnItsOwn(step, emailWritten);
  const want = own && !step.aiAsk;
  const [busy, setBusy] = useState(want);
  const [off, setOff] = useState(false);
  const ask = (fill: boolean) => read().then((r) => {
    setBusy(false);
    if (r === "off") { setOff(true); return; }
    if (!r) return;
    if (fill) { onFill(r); onCache({ ...r, dismissed: true }); } else onCache(r);
  });
  // Offered on its own once, when the page opens on an empty client step.
  useEffect(() => { if (want) void ask(false); }, [step.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (off || step.done) return null;
  if (busy) return <p className={`${AI_BOX} ${AI_LABEL}`} aria-live="polite">✨ Claude is writing it…</p>;
  const a = step.aiAsk && !step.aiAsk.dismissed ? step.aiAsk : null;
  if (a) return (
    <section aria-label="Claude's suggestion" className={`${AI_BOX} flex flex-col gap-2`}>
      <p className={AI_LABEL}>✨ What we need from {first}</p>
      <p className="text-[16px] text-foreground [overflow-wrap:anywhere]">{a.need}</p>
      {a.body && (
        <details className="text-[16px]">
          <summary className="cursor-pointer font-semibold text-accent">And the email{a.subject ? `: ${a.subject}` : ""}</summary>
          <p className="mt-1 whitespace-pre-line text-muted [overflow-wrap:anywhere]">{a.body}</p>
        </details>
      )}
      <div className="flex flex-col-reverse gap-3 border-t border-violet-200 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-violet-400/30">
        <button onClick={() => onCache({ ...a, dismissed: true })} className="text-[16px] text-muted hover:text-foreground">No thanks</button>
        <button onClick={() => { onFill(a); onCache({ ...a, dismissed: true }); }}
          className="h-11 w-full rounded-[5px] bg-accent px-5 text-[16px] font-semibold text-white hover:opacity-90 sm:w-auto">Use this</button>
      </div>
    </section>
  );
  return (
    <button type="button" onClick={() => { setBusy(true); void ask(true); }}
      className="self-start text-[16px] font-semibold text-violet-700 underline-offset-4 hover:underline dark:text-violet-300">✨ Write it for me</button>
  );
}
