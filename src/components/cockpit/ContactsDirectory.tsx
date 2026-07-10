"use client";

// The "Contacts" tab — a searchable directory over every synced GoHighLevel
// contact (both sub-accounts), independent of whether it's been classified
// as a client/prospect/past client/vendor. AddClientModal covers the same
// data for a quick "add while I'm elsewhere" flow; this is the full browse +
// classify + jump-to-record view.
import { useMemo, useState } from "react";
import { CLIENT_TYPE_META, type Client, type Contact, type ClientType } from "@/lib/data";
import { I, ClassifyMenu } from "./ui";

export function ContactsDirectory({ contacts, clients, subAccounts, onClassify, onOpenClient }: {
  contacts: Contact[];
  clients: Client[];
  subAccounts: Client[];
  onClassify: (contact: Contact, type: ClientType) => void;
  onOpenClient: (clientId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sub, setSub] = useState("all");

  const clientByContactId = useMemo(() => new Map(clients.filter((c) => c.id.startsWith("cl_")).map((c) => [c.id.slice(3), c])), [clients]);
  const subById = useMemo(() => new Map(subAccounts.map((s) => [s.id, s])), [subAccounts]);

  const ql = q.trim().toLowerCase();
  const filtered = contacts.filter((c) => (sub === "all" || c.clientId === sub) && (!ql || c.name.toLowerCase().includes(ql) || (c.email ?? "").toLowerCase().includes(ql)));
  const list = ql ? filtered.slice(0, 200) : filtered.slice(0, 100);

  const ghlUrl = (c: Contact) => {
    const s = subById.get(c.clientId);
    return s?.ghlLocationId ? `https://app.gohighlevel.com/v2/location/${s.ghlLocationId}/contacts/detail/${c.ghlContactId}` : null;
  };

  return (
    <div className="flex-1 overflow-auto bg-background p-4 sm:p-5">
      <div className="mb-3 flex gap-2">
        <select value={sub} onChange={(e) => setSub(e.target.value)} className="rounded-md border bg-background px-2 py-1.5 text-[15px] outline-none">
          <option value="all">All sub-accounts</option>
          {subAccounts.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="flex-1 max-w-sm rounded-md border bg-background px-3 py-1.5 text-[15px] outline-none focus:border-accent" />
        <span className="self-center text-[13px] text-muted">{filtered.length.toLocaleString()} contact{filtered.length === 1 ? "" : "s"}</span>
      </div>

      <div className="overflow-hidden rounded-xl border bg-surface shadow-soft">
        {list.length === 0 && <div className="px-4 py-10 text-center text-[15px] text-muted">No matching contacts</div>}
        {list.map((c) => {
          const client = clientByContactId.get(c.id);
          const s = subById.get(c.clientId);
          const url = ghlUrl(c);
          return (
            <div key={c.id} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-0 hover:bg-accent-soft/50">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s?.color ?? "#94a3b8" }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{c.name}</div>
                <div className="truncate text-[13px] text-muted">{c.email || "no email"} · {s?.name ?? "—"}</div>
              </div>
              {url && <a href={url} target="_blank" rel="noopener noreferrer" title="Open in GoHighLevel" className="shrink-0 rounded-md p-1.5 text-muted hover:bg-background hover:text-accent"><I.bolt /></a>}
              {client ? (
                <button onClick={() => onOpenClient(client.id)} className="shrink-0 rounded-md px-2.5 py-1 text-[13px] font-medium hover:bg-background" style={{ color: CLIENT_TYPE_META[client.type].color }}>
                  {CLIENT_TYPE_META[client.type].label}
                </button>
              ) : (
                <ClassifyMenu onClassify={(type) => onClassify(c, type)} />
              )}
            </div>
          );
        })}
        {!ql && filtered.length > list.length && <div className="px-4 py-2 text-[13px] text-muted">Showing {list.length} of {filtered.length.toLocaleString()} — type to search all.</div>}
      </div>
    </div>
  );
}
