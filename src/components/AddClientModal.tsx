"use client";

import { useEffect, useState } from "react";
import { type Client, type Contact } from "@/lib/data";
import { authedFetch } from "@/lib/supabase";

export type GhlContactHit = { ghlContactId: string; locationId: string; name: string; email: string; phone: string; company: string; city: string; state: string };

// Search synced GoHighLevel contacts (across sub-accounts) and add one as a
// client. A client's id is `cl_<contactId>` so it always ties back to its
// source contact + sub-account.
export default function AddClientModal({
  subAccounts,
  contacts,
  existingIds,
  onAdd,
  onAddRemote,
  onClose,
}: {
  subAccounts: Client[];
  contacts: Contact[];
  existingIds: Set<string>;
  onAdd: (contact: Contact) => void;
  /** Adds someone found in GoHighLevel who isn't in the local contacts table yet. */
  onAddRemote: (hit: GhlContactHit) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sub, setSub] = useState("all");
  const subName = (id: string) => subAccounts.find((s) => s.id === id)?.name ?? "—";
  const subColor = (id: string) => subAccounts.find((s) => s.id === id)?.color ?? "#94a3b8";
  const ghlUrl = (c: Contact) => {
    const loc = subAccounts.find((s) => s.id === c.clientId)?.ghlLocationId;
    return loc && c.ghlContactId ? `https://app.gohighlevel.com/v2/location/${loc}/contacts/detail/${c.ghlContactId}` : null;
  };
  const ql = q.trim().toLowerCase();
  const list = contacts
    .filter((c) => sub === "all" || c.clientId === sub)
    .filter((c) => !ql || c.name.toLowerCase().includes(ql) || (c.email ?? "").toLowerCase().includes(ql))
    .slice(0, 60);

  // The local contacts table is only as fresh as the last bulk sync, so a
  // contact added to a sub-account this morning isn't in it. When nothing
  // local matches, ask GoHighLevel itself rather than reporting that the
  // person doesn't exist.
  const [remote, setRemote] = useState<GhlContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    let live = true;
    // Both branches go through the timer, so nothing sets state synchronously
    // in the effect body. Clearing on the same path also means a fast typist
    // never sees results from the previous query flash under the new one.
    const t0 = setTimeout(() => { if (live) { setRemote([]); setSearching(ql.length >= 3 && list.length === 0); } }, 0);
    if (ql.length < 3 || list.length > 0) return () => { live = false; clearTimeout(t0); };
    // Debounced: this hits the GHL API once per configured sub-account, which
    // is not something to fire on every keystroke.
    const t = setTimeout(async () => {
      try {
        const res = await authedFetch("/api/ghl/search-contacts", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: q.trim() }),
        });
        const j = await res.json().catch(() => ({}));
        if (live) setRemote(Array.isArray(j?.contacts) ? j.contacts : []);
      } catch { if (live) setRemote([]); }
      finally { if (live) setSearching(false); }
    }, 450);
    return () => { live = false; clearTimeout(t0); clearTimeout(t); };
  }, [ql, q, list.length]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-[16px] font-semibold">Add a client</h2>
            <p className="text-[13px] text-muted">Search your GoHighLevel contacts and add one as a client.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background">✕</button>
        </div>

        <div className="flex gap-2 border-b px-5 py-2.5">
          <select value={sub} onChange={(e) => setSub(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-[15px] outline-none">
            <option value="all">All sub-accounts</option>
            {subAccounts.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="flex-1 rounded-md border bg-background px-3 py-1.5 text-[15px] outline-none focus:border-accent" />
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-3 py-2">
          {list.length === 0 && remote.length === 0 && (
            <div className="py-8 text-center text-[13px] text-muted">
              {searching ? "Searching GoHighLevel…" : ql.length >= 3 ? "No matching contacts" : "Type at least 3 characters."}
            </div>
          )}
          {list.map((c) => {
            const added = existingIds.has("cl_" + c.id);
            return (
              <div key={c.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-background">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subColor(c.clientId) }} />
                <div className="min-w-0 flex-1">
                  {ghlUrl(c)
                    ? <a href={ghlUrl(c)!} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="block truncate text-[15px] font-medium text-accent hover:underline">{c.name}</a>
                    : <div className="truncate text-[15px] font-medium">{c.name}</div>}
                  <div className="truncate text-[13px] text-muted">{c.company ? `${c.company} · ` : ""}{c.email || "no email"} · {subName(c.clientId)}</div>
                </div>
                <button disabled={added} onClick={() => onAdd(c)} className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[15px] font-medium text-white disabled:opacity-40">{added ? "Added" : "Add"}</button>
              </div>
            );
          })}
          {remote.length > 0 && (
            <>
              <div className="mt-2 border-t px-2 pb-1 pt-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                Found in GoHighLevel · not synced here yet
              </div>
              {remote.map((h) => {
                const added = existingIds.has(`cl_ct_ghl_${h.ghlContactId}`);
                return (
                  <div key={h.ghlContactId} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-background">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-border" />
                    <div className="min-w-0 flex-1">
                      <a href={`https://app.gohighlevel.com/v2/location/${h.locationId}/contacts/detail/${h.ghlContactId}`}
                        target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel"
                        className="block truncate text-[15px] font-medium text-accent hover:underline">{h.name}</a>
                      <div className="truncate text-[13px] text-muted">{h.company ? `${h.company} · ` : ""}{h.email || h.phone || "no email"}</div>
                    </div>
                    <button disabled={added} onClick={() => onAddRemote(h)}
                      className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[15px] font-medium text-white disabled:opacity-40">{added ? "Added" : "Add"}</button>
                  </div>
                );
              })}
            </>
          )}
          {searching && list.length === 0 && remote.length === 0 && null}
          {!ql && contacts.length > 60 && <div className="px-2 py-1.5 text-[13px] text-muted">Showing 60 — type to search all {contacts.length.toLocaleString()} contacts.</div>}
        </div>
      </div>
    </>
  );
}
