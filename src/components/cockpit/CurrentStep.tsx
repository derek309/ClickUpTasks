"use client";

// The current step on the task view (Derek, 2026-10-17): it reads, it does
// nothing. Its number and name, the turn line to read ("Carol's turn, need by
// Fri, Oct 16, reminded every 3 days") and one quiet line about what it holds
// ("Draft · not given to Michaella yet"). The whole card opens the step's
// page, where all the working happens: Done, Give to, Message, the waiting
// choices, Reply, + Add and What's next after Done. The same on a phone.

/** The same name, whatever the case and spacing: a step named as its task
 *  does not say its name again (Derek, 2026-10-14). */
export const sameStepName = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

export function CurrentStep({ number, title, showName, line, quiet, message, lead, face, lineTone = "", onOpenStep }: {
  /** Its number in the steps, shown with its name. */
  number: number;
  /** Its name ("What's next?" on a step that asks it). */
  title: string;
  /** False when the step has the task's name: only the turn line shows. */
  showName: boolean;
  /** The turn line, words only. */
  line: string;
  /** What it holds and where it stands, or "" for nothing. */
  quiet: string;
  /** The step's latest message ("You to Michaella: Did this one get sent
   *  out? · just now"), or an open question for the person looking, which
   *  reads as the amber "Question from Michaella". */
  message?: { text: string; questionFrom?: string } | null;
  /** The coloured dot before the turn line. */
  lead?: React.ReactNode;
  /** Whose turn as a face, top right. */
  face?: React.ReactNode;
  /** The turn line's colour. */
  lineTone?: string;
  onOpenStep: () => void;
}) {
  return (
    <button type="button" onClick={onOpenStep} aria-label={`Open step ${number}: ${title}`}
      className="-m-2 flex w-[calc(100%+1rem)] min-w-0 items-start gap-3 rounded-[5px] p-2 text-left hover:bg-background">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {showName && (
          <span className="text-[20px] font-bold leading-snug [overflow-wrap:anywhere]">
            <span className="mr-1.5 tabular-nums text-muted">{number}.</span>{title}
          </span>
        )}
        <span className={`text-[16px] font-semibold leading-snug sm:text-[18px] ${lineTone}`}>{lead}{!showName && <span className="mr-1.5 tabular-nums text-muted">{number}.</span>}{line}</span>
        {quiet && <span className="text-[16px] leading-snug text-muted [overflow-wrap:anywhere]">{quiet}</span>}
        {message?.questionFrom ? (
          <span className="text-[16px] leading-snug [overflow-wrap:anywhere]">
            <span className="font-semibold text-amber-800 dark:text-amber-300">Question from {message.questionFrom}</span>{" "}<span className="text-foreground">{message.text}</span>
          </span>
        ) : message ? <span className="text-[16px] leading-snug text-muted [overflow-wrap:anywhere]">{message.text}</span> : null}
      </span>
      {face && <span className="flex shrink-0 items-center gap-2 pt-0.5">{face}</span>}
    </button>
  );
}
