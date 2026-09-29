import type { Subtask } from "@/lib/data";

/** One checklist item's change, saved on its own (Cockpit update's third argument). */
export type ChecklistChange = { patch: string; with: Partial<Subtask> } | { append: Subtask[] } | { remove: string };
