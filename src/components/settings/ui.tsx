// Settings, drawn like the rest of the app (Derek, 2026-10-12: "redesign the
// settings to match the rest of the site"): the task page's cards (5px
// corners, a soft shadow), a coloured icon tile beside each heading, 16px
// text, and status said in coloured words, never a pill.
import type { ReactNode } from "react";

export type Tone = "indigo" | "sky" | "amber" | "emerald" | "rose" | "violet" | "slate";
export const TONE: Record<Tone, string> = {
  indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  sky: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};

export const Tile = ({ icon, tone, big }: { icon: ReactNode; tone: Tone; big?: boolean }) => (
  <span className={`flex shrink-0 items-center justify-center rounded-[5px] ${big ? "h-10 w-10" : "h-7 w-7"} ${TONE[tone]}`}>{icon}</span>
);

/** One block of a settings page: the task page's card. */
export function SettingsCard({ title, icon, tone = "slate", status, hint, children }: {
  title: string; icon?: ReactNode; tone?: Tone; status?: ReactNode; hint?: ReactNode; children?: ReactNode;
}) {
  return (
    <section className="rounded-[5px] border bg-surface p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-[16px] font-bold text-foreground">
          {icon && <Tile icon={icon} tone={tone} />}{title}
        </h2>
        {status}
      </div>
      {hint && <p className="mt-2 text-[16px] text-muted">{hint}</p>}
      {children && <div className={hint ? "mt-3" : "mt-3"}>{children}</div>}
    </section>
  );
}

/** "● Connected" in green, "● Not connected" in amber: words, not a pill. */
export function StatusWord({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  const tone = ok === null ? "text-muted" : ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300";
  const dot = ok === null ? "bg-muted" : ok ? "bg-emerald-500" : "bg-amber-500";
  return <span className={`inline-flex items-center gap-1.5 text-[16px] font-semibold ${tone}`}><span className={`h-2 w-2 rounded-full ${dot}`} />{children}</span>;
}

export const BTN = "inline-flex items-center justify-center gap-1.5 rounded-[5px] border bg-surface px-3 py-1.5 text-[16px] font-medium hover:bg-background disabled:opacity-50";
export const BTN_PRIMARY = "inline-flex items-center justify-center gap-1.5 rounded-[5px] bg-accent px-3 py-1.5 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-40";
export const BTN_DANGER = "inline-flex items-center justify-center gap-1.5 rounded-[5px] border border-danger/40 px-3 py-1.5 text-[16px] font-medium text-danger hover:bg-danger/10 disabled:opacity-50";
export const INPUT = "h-10 min-w-0 rounded-[5px] border bg-surface px-3 text-[16px] outline-none focus:border-accent";
export const ROW = "rounded-[5px] border bg-background px-3 py-2.5";
