"use client";

// Ambassador territory dashboard: an admin assigns a city+state to a
// teammate, and this panel shows every GHL contact in that city/state split
// into "claimed" (already added as a client — see clients.id = 'cl_'+contact.id)
// vs "unclaimed" (still just a raw synced contact). Reuses the existing client
// status funnel for pipeline stage instead of a second, parallel state.
import { useState } from "react";
import { users, clientStatusMeta, normalizeState, type Me, type Territory, type Contact, type Client } from "@/lib/data";
import { I, Avatar } from "./cockpit/ui";

export default function TerritoryPanel({ me, canAdmin, territories, contacts, clients, onAddTerritory, onAssignTerritory, onDeleteTerritory, onAddContact, onOpenClient, onClose }: {
  me: Me; canAdmin: boolean;
  territories: Territory[]; contacts: Contact[]; clients: Client[];
  onAddTerritory: (t: { name: string; city: string; state: string; memberId: string | null }) => void;
  onAssignTerritory: (id: string, memberId: string | null) => void;
  onDeleteTerritory: (id: string) => void;
  onAddContact: (contact: Contact) => void;
  onOpenClient: (clientId: string) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [assignTo, setAssignTo] = useState("");

  const visible = canAdmin ? territories : territories.filter((t) => t.memberId === me.id);
  const clientIds = new Set(clients.map((c) => c.id));
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = () => {
    if (!name.trim() || !city.trim() || !state.trim()) return;
    onAddTerritory({ name: name.trim(), city: city.trim(), state: state.trim(), memberId: assignTo || null });
    setName(""); setCity(""); setState(""); setAssignTo(""); setAddOpen(false);
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-[16px] font-semibold">Territories</h2>
            <p className="text-[15px] text-muted">{canAdmin ? "Assign cities to ambassadors and track their pipeline." : "Contacts in your assigned territory."}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-background"><I.close /></button>
        </div>

        {canAdmin && (
          <div className="border-b bg-background/40 px-5 py-3">
            {addOpen ? (
              <div className="flex flex-wrap items-center gap-2">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Territory name (e.g. Rocklin)" className="min-w-0 flex-1 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="w-32 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
                <input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" className="w-20 rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
                <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="rounded-md border bg-surface px-2 py-1.5 text-[15px] outline-none focus:border-accent">
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button onClick={submit} disabled={!name.trim() || !city.trim() || !state.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Add</button>
                <button onClick={() => setAddOpen(false)} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-[15px] font-medium text-muted hover:bg-background hover:text-foreground">
                <I.plus /> Add territory
              </button>
            )}
          </div>
        )}

        <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
          {visible.length === 0 && (
            <div className="py-8 text-center text-[15px] text-muted">
              {canAdmin ? "No territories yet — click \"Add territory\" to assign a city to a teammate." : "No territory assigned to you yet."}
            </div>
          )}
          {visible.map((t) => {
            const territoryState = normalizeState(t.state);
            const matched = contacts.filter((c) => (c.city ?? "").trim().toLowerCase() === t.city.toLowerCase() && c.state && normalizeState(c.state) === territoryState);
            const unclaimed = matched.filter((c) => !clientIds.has("cl_" + c.id));
            const claimed = matched.filter((c) => clientIds.has("cl_" + c.id));
            const open = expanded.has(t.id);
            return (
              <div key={t.id} className="mb-2 rounded-xl border">
                <button onClick={() => toggle(t.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                  <I.chevron className={`shrink-0 text-muted transition ${open ? "rotate-90" : ""}`} />
                  <I.flag className="shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{t.name}</div>
                    <div className="truncate text-[13px] text-muted">{t.city}, {t.state} · {claimed.length} claimed · {unclaimed.length} unclaimed</div>
                  </div>
                  {canAdmin ? (
                    <select value={t.memberId ?? ""} onClick={(e) => e.stopPropagation()} onChange={(e) => onAssignTerritory(t.id, e.target.value || null)}
                      className="shrink-0 rounded-md border bg-background px-2 py-1 text-[13px] outline-none focus:border-accent">
                      <option value="">Unassigned</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  ) : (
                    <Avatar id={t.memberId} size={24} />
                  )}
                  {canAdmin && (
                    <span onClick={(e) => { e.stopPropagation(); onDeleteTerritory(t.id); }} title="Delete territory" className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-danger"><I.trash /></span>
                  )}
                </button>
                {open && (
                  <div className="space-y-1 border-t px-3 py-2">
                    {matched.length === 0 && <div className="py-3 text-center text-[13px] text-muted">No synced GoHighLevel contacts match {t.city}, {t.state} yet.</div>}
                    {unclaimed.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[15px]">
                        <span className="min-w-0 flex-1 truncate text-muted">{c.name}{c.company && <span className="text-muted/70"> · {c.company}</span>}</span>
                        <button onClick={() => onAddContact(c)} className="shrink-0 rounded-md border border-dashed px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft">+ Add as client</button>
                      </div>
                    ))}
                    {claimed.map((c) => {
                      const client = clients.find((cl) => cl.id === "cl_" + c.id);
                      if (!client) return null;
                      const meta = clientStatusMeta(client.status);
                      return (
                        <button key={c.id} onClick={() => onOpenClient(client.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[15px] hover:bg-background">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.dot }} />
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                          <span className="shrink-0 text-[13px] text-muted">{meta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
