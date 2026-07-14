"use client";

import { useState } from "react";
import { type Client, type Contact } from "@/lib/data";

// Search synced GoHighLevel contacts (across sub-accounts) and add one as a
// client. A client's id is `cl_<contactId>` so it always ties back to its
// source contact + sub-account.
export default function AddClientModal({
  subAccounts,
  contacts,
  existingIds,
  onAdd,
  onClose,
}: {
  subAccounts: Client[];
  contacts: Contact[];
  existingIds: Set<string>;
  onAdd: (contact: Contact) => void;
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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-[16px] font-semibold">Add a client</h2>
            <p className="text-[15px] text-muted">Search your GoHighLevel contacts and add one as a client.</p>
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
          {list.length === 0 && <div className="py-8 text-center text-[15px] text-muted">No matching contacts</div>}
          {list.map((c) => {
            const added = existingIds.has("cl_" + c.id);
            return (
              <div key={c.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-background">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subColor(c.clientId) }} />
                <div className="min-w-0 flex-1">
                  {ghlUrl(c)
                    ? <a href={ghlUrl(c)!} target="_blank" rel="noopener noreferrer" title="Open this contact in GoHighLevel" className="block truncate text-[15px] font-medium text-accent hover:underline">{c.name}</a>
                    : <div className="truncate text-[15px] font-medium">{c.name}</div>}
                  <div className="truncate text-[15px] text-muted">{c.company ? `${c.company} · ` : ""}{c.email || "no email"} · {subName(c.clientId)}</div>
                </div>
                <button disabled={added} onClick={() => onAdd(c)} className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[15px] font-medium text-white disabled:opacity-40">{added ? "Added" : "Add"}</button>
              </div>
            );
          })}
          {!ql && contacts.length > 60 && <div className="px-2 py-1.5 text-[15px] text-muted">Showing 60 — type to search all {contacts.length.toLocaleString()} contacts.</div>}
        </div>
      </div>
    </>
  );
}
