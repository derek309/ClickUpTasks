"use client";

// A reply held for the undo window (Derek, 2026-10-07: "instead of this
// 5 second timer coming up, just push the message up and then put an undo
// button ... after 5 seconds, remove the undo"). The reply box hands its
// message here and closes; the conversation shows it at the bottom, faded,
// with Undo under it, until it really goes.

import { useSyncExternalStore } from "react";

export type PendingSend = { id: string; threadKey: string; body: string; rich: boolean; undo: () => void };

let items: PendingSend[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function addPendingSend(p: PendingSend) { items = [...items, p]; emit(); }
export function removePendingSend(id: string) { items = items.filter((x) => x.id !== id); emit(); }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const none: PendingSend[] = [];
/** This conversation's replies still inside their undo window. */
export function usePendingSends(threadKey: string): PendingSend[] {
  const all = useSyncExternalStore(subscribe, () => items, () => none);
  return all.filter((x) => x.threadKey === threadKey);
}
