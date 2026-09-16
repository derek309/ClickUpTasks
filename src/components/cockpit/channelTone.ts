// One colour per way of talking, used in the conversation and in the reply box
// alike, so a yellow note, a violet chat, a green text and a blue email look
// the same where they were written and where they landed (Derek, 2026-09-16:
// "so that in the timeline they're consistent").
//
// Rings, not border colours: globals.css paints every border with --border
// and that plain rule outranks Tailwind's layered border colour classes.
export type ToneChannel = "note" | "chat" | "sms" | "email";

export const CHANNEL_TONE: Record<ToneChannel, {
  /** A bubble, card or the reply field: tinted ground and a matching ring. */
  surface: string;
  /** The picked tab in the reply box: coloured text and underline. */
  tab: string;
  /** The send button. */
  send: string;
  /** The channel's name written in its colour. */
  label: string;
}> = {
  note: {
    surface: "bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/30",
    tab: "text-amber-800 shadow-[inset_0_-2px_0_#b45309] dark:text-amber-300",
    send: "bg-amber-700",
    label: "text-amber-800 dark:text-amber-300",
  },
  chat: {
    surface: "bg-violet-50 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:ring-violet-500/30",
    tab: "text-violet-700 shadow-[inset_0_-2px_0_#7c3aed] dark:text-violet-300",
    send: "bg-violet-600",
    label: "text-violet-700 dark:text-violet-300",
  },
  sms: {
    surface: "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30",
    tab: "text-emerald-700 shadow-[inset_0_-2px_0_#059669] dark:text-emerald-300",
    send: "bg-emerald-600",
    label: "text-emerald-700 dark:text-emerald-300",
  },
  email: {
    surface: "bg-sky-50 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:ring-sky-500/30",
    tab: "text-sky-700 shadow-[inset_0_-2px_0_#0284c7] dark:text-sky-300",
    send: "bg-sky-600",
    label: "text-sky-700 dark:text-sky-300",
  },
};
