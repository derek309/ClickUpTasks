"use client";

// "From (530) 362 0990 · ClickUpLocal ▾" over a text box (Derek, 2026-10-15:
// "When we're texting, can you show all of our GHL numbers that we can text
// from and which account they're on?"). The menu lists every number we can
// text from, grouped by sub account; a number in another account than the
// person's is shown but can't be picked, since they aren't a contact there.
// Unless one is picked, a text goes from the number the conversation last
// used, else the account's default (lib/textFrom), the same rule the send
// routes use.
//
// A pick is kept for the session under a key (the conversation, or the
// client), so every text box for that client and the send itself read the
// same pick without passing it through each screen in between.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { authedFetch } from "@/lib/supabase";
import { defaultFromNumber, formatPhone, samePhone, type FromHistoryItem, type TextAccount, type TextNumber } from "@/lib/textFrom";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";

// ── The numbers, read once a session ─────────────────────────────────────
type Loaded = { accounts: TextAccount[]; numbers: TextNumber[] };
let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;

function loadNumbers(): Promise<Loaded> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= authedFetch("/api/ghl/numbers")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const got: Loaded = { accounts: Array.isArray(j?.accounts) ? j.accounts : [], numbers: Array.isArray(j?.numbers) ? j.numbers : [] };
      if (got.numbers.length) loaded = got;
      return got;
    })
    .catch(() => ({ accounts: [], numbers: [] }))
    .finally(() => { loading = null; });
  return loading;
}

export function useTextNumbers(): Loaded | null {
  const [state, setState] = useState<Loaded | null>(loaded);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void loadNumbers().then((l) => { if (live) setState(l); });
    return () => { live = false; };
  }, []);
  return state;
}

// ── The pick, per conversation or client ─────────────────────────────────
const picks = new Map<string, string>();
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** The number picked for this conversation or client, if any. */
export const fromPick = (key: string | null | undefined): string | null => (key ? picks.get(key) ?? null : null);
export function setFromPick(key: string, number: string | null) {
  if (number) picks.set(key, number); else picks.delete(key);
  listeners.forEach((f) => f());
}
const useFromPick = (key: string) => useSyncExternalStore(subscribe, () => fromPick(key), () => null);

/** The pick keys, so the box and its send use the same one. */
export const fromKey = {
  thread: (threadKey: string) => `thread:${threadKey}`,
  client: (clientId: string) => `client:${clientId}`,
  contact: (contactId: string) => `contact:${contactId}`,
};

/** Where a text box is: the pick's key, the person's sub account (null when
 *  not known here; the send checks it), what was said before, and their
 *  first name for the menu. */
export type FromNumberProps = { pickKey: string; locationId: string | null; history: FromHistoryItem[]; firstName: string; className?: string };

export function FromNumberLine({ pickKey, locationId: givenLocation, history, firstName, className = "" }: FromNumberProps) {
  const list = useTextNumbers();
  const picked = useFromPick(pickKey);
  const numbers = useMemo(() => list?.numbers ?? [], [list]);
  // A location none of our accounts has (a client row holding a company name
  // there) is as good as unknown: nothing is held back, the send checks.
  const locationId = givenLocation && list?.accounts.some((a) => a.locationId === givenLocation) ? givenLocation : null;
  const fallback = useMemo(() => defaultFromNumber({ numbers, locationId, history }), [numbers, locationId, history]);
  // A pick that is no longer allowed here (another account) does not count.
  const pickedNumber = picked ? numbers.find((n) => samePhone(n.number, picked) && (!locationId || n.locationId === locationId)) ?? null : null;
  const current = pickedNumber ?? fallback;
  const lastUsed = fallback && history.some((m) => m.ourNumber && samePhone(m.ourNumber, fallback.number)) ? fallback.number : null;
  if (!list) return null;
  const accounts = list.accounts.length ? list.accounts : [];
  if (!accounts.length) return null;

  const items: ActionMenuItem[] = [];
  for (const a of accounts) {
    const other = !!locationId && a.locationId !== locationId;
    if (a.error && !a.numbers.length) {
      items.push({ heading: a.name, label: "Numbers not available", note: a.error, disabled: true, onClick: () => {} });
      continue;
    }
    a.numbers.forEach((n, i) => {
      const notes = [
        n.label,
        n.isDefault ? "the account's default" : null,
        lastUsed && samePhone(lastUsed, n.number) ? `the one ${firstName} knows` : null,
      ].filter(Boolean);
      items.push({
        heading: i === 0 ? a.name : undefined,
        label: formatPhone(n.number),
        note: other ? `${firstName} isn't in this account: they'd get it from a number they don't know` : notes.join(" · ") || undefined,
        disabled: other,
        checked: !!current && samePhone(current.number, n.number),
        onClick: () => setFromPick(pickKey, fallback && samePhone(fallback.number, n.number) ? null : n.number),
      });
    });
  }
  const label = current
    ? <>From <b className="font-semibold text-foreground">{formatPhone(current.number)}</b> · {current.locationName} ▾</>
    : <>From the account&apos;s usual number ▾</>;
  const changed = !!pickedNumber && !!lastUsed && !samePhone(pickedNumber.number, lastUsed);
  return (
    // Wraps rather than running off a phone's edge (375px).
    <div className={`min-w-0 max-w-full text-[16px] text-muted ${className}`}>
      <ActionMenu sheet title="Which of our numbers this text goes from" label={label} items={items}
        triggerClassName="max-w-full break-words rounded-[5px] py-0.5 text-left text-[16px] text-muted hover:text-foreground" />
      {changed && <div className="font-semibold text-highlight">Not the number {firstName} knows</div>}
    </div>
  );
}

/** Our sent texts' numbers in a thread, oldest first: "from (530) 362 0990",
 *  marked when it is not the number our text before it came from. */
export function FromNote({ note }: { note: { number: string; changed: boolean } | undefined }) {
  if (!note) return null;
  return note.changed
    ? <span className="font-semibold text-highlight">from a different number, {formatPhone(note.number)}</span>
    : <span className="text-muted">from {formatPhone(note.number)}</span>;
}
