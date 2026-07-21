"use client";

// Ambassador territory dashboard: an admin assigns a city+state to a
// teammate, and this panel shows every GHL contact in that city/state split
// into "claimed" (already added as a client — see clients.id = 'cl_'+contact.id)
// vs "unclaimed" (still just a raw synced contact). Reuses the existing client
// status funnel for pipeline stage instead of a second, parallel state.
import { useState } from "react";
import { users, clientStatusMeta, normalizeState, type Me, type Territory, type Contact, type Client, type ClientStatus } from "@/lib/data";
import { I, Avatar } from "./cockpit/ui";
import TerritoryDirectory from "./cockpit/TerritoryDirectory";

export default function TerritoryPanel({ me, canAdmin, territories, contacts, clients, onAddTerritory, onToggleAssignee, onDeleteTerritory, onAddContact, onSyncClients, onSetStatus, onOpenClient, featuredClientIds, onFeature, focusId }: {
  me: Me; canAdmin: boolean;
  territories: Territory[]; contacts: Contact[]; clients: Client[];
  onAddTerritory: (t: { name: string; city: string; state: string; assignedTo: string[] }) => void;
  onToggleAssignee: (id: string, memberId: string) => void; // toggle a teammate on/off a city
  onDeleteTerritory: (id: string) => void;
  onAddContact: (contact: Contact) => void; // open (existing) or immediately create+open (new) — no confirm
  // Auto-sync + inline stage editing — only reachable via the focused
  // single-city page (see TerritoryDirectory), so optional here: the admin
  // multi-city overview below never sets focusId and never needs them.
  onSyncClients?: (contacts: Contact[]) => void;
  onSetStatus?: (clientId: string, status: ClientStatus) => void;
  onOpenClient: (clientId: string) => void;
  // Newsletter feature motion, threaded straight through to the city view.
  featuredClientIds?: Set<string>;
  onFeature?: (opts: { clientId: string | null; contact: Contact | null; name: string; city: string; state: string }) => void;
  focusId?: string; // when set, render only this one city, auto-expanded (the sidebar city page)
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => (focusId ? new Set([focusId]) : new Set()));
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [assignSet, setAssignSet] = useState<Set<string>>(new Set());
  const [assignMenu, setAssignMenu] = useState<string | null>(null); // territory id whose assignee popover is open
  const [sort, setSort] = useState<"score" | "name">("score"); // the focused city's business sort — lives here so it can sit on the same header line as the client/contact counts

  const scoped = canAdmin ? territories : territories.filter((t) => (t.assignedTo ?? []).includes(me.id));
  const visible = focusId ? scoped.filter((t) => t.id === focusId) : scoped;
  const clientIds = new Set(clients.map((c) => c.id));
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAssign = (id: string) => setAssignSet((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const submit = () => {
    if (!name.trim() || !city.trim() || !state.trim()) return;
    onAddTerritory({ name: name.trim(), city: city.trim(), state: state.trim(), assignedTo: [...assignSet] });
    setName(""); setCity(""); setState(""); setAssignSet(new Set()); setAddOpen(false);
  };

  return (
    <div>
        {canAdmin && !focusId && (
          <div className="border-b bg-background/40 px-5 py-3">
            {addOpen ? (
              <div className="space-y-2.5">
                <div>
                  <label className="block text-[13px] font-medium text-muted">Territory name</label>
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rocklin" onKeyDown={(e) => { if (e.key === "Escape") setAddOpen(false); }}
                    className="mt-1 w-full rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
                </div>
                <div className="flex gap-2.5">
                  <div className="flex-1">
                    <label className="block text-[13px] font-medium text-muted">City</label>
                    <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Rocklin" onKeyDown={(e) => { if (e.key === "Escape") setAddOpen(false); }}
                      className="mt-1 w-full rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
                  </div>
                  <div className="w-28">
                    <label className="block text-[13px] font-medium text-muted">State</label>
                    <input value={state} onChange={(e) => setState(e.target.value)} placeholder="CA" onKeyDown={(e) => { if (e.key === "Escape") setAddOpen(false); }}
                      className="mt-1 w-full rounded-md border bg-surface px-2.5 py-1.5 text-[15px] outline-none focus:border-accent" />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted">Ambassadors <span className="font-normal">(one or more)</span></label>
                  <div className="mt-1 grid grid-cols-2 gap-0.5">
                    {users.map((u) => {
                      const on = assignSet.has(u.id);
                      return (
                        <button key={u.id} onClick={() => toggleAssign(u.id)} className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-white" : "border-border"}`}>{on && <I.check />}</span>
                          <Avatar id={u.id} size={18} /> <span className="truncate text-[13px]">{u.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button onClick={() => setAddOpen(false)} className="rounded-md border px-3 py-1.5 text-[15px] font-medium hover:bg-background">Cancel</button>
                  <button onClick={submit} disabled={!name.trim() || !city.trim() || !state.trim()} className="rounded-md bg-accent px-3 py-1.5 text-[15px] font-medium text-white disabled:opacity-40">Add territory</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-[13px] font-medium text-muted hover:bg-background hover:text-foreground">
                <I.plus /> Add territory
              </button>
            )}
          </div>
        )}

        <div className="px-5 py-3">
          {visible.length === 0 && (
            <div className="py-8 text-center text-[13px] text-muted">
              {canAdmin ? "No territories yet — click \"Add territory\" to assign a city to a teammate." : "No territory assigned to you yet."}
            </div>
          )}
          {visible.map((t) => {
            const territoryState = normalizeState(t.state);
            const matched = contacts.filter((c) => (c.city ?? "").trim().toLowerCase() === t.city.toLowerCase() && c.state && normalizeState(c.state) === territoryState);
            const unclaimed = matched.filter((c) => !clientIds.has("cl_" + c.id));
            const claimed = matched.filter((c) => clientIds.has("cl_" + c.id));
            const open = focusId ? true : expanded.has(t.id);
            // The focused single-city page (opened from the sidebar) doesn't
            // need a click-to-expand accordion around content that's already
            // the whole page — that read as a "toggle box" unlike how
            // Tasks/Projects render (a plain header, then the list). Only the
            // admin multi-city overview (focusId unset) keeps the accordion,
            // since it's genuinely browsing several cities at once.
            const HeaderTag = focusId ? "div" : "button";
            return (
              <div key={t.id} className={focusId ? "" : "mb-2 rounded-xl border"}>
                <HeaderTag {...(focusId ? {} : { onClick: () => toggle(t.id) })} className="flex w-full items-center gap-3 px-1 py-2.5 text-left">
                  {!focusId && <I.chevron className={`shrink-0 text-muted transition ${open ? "rotate-90" : ""}`} />}
                  <I.flag className="shrink-0 text-accent" />
                  {focusId ? (
                    // The city name/state is already the page's own title
                    // (the app header above) — repeating it here just to add
                    // the scoped counts would duplicate it, so this is one
                    // compact line, not a second stacked title.
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{claimed.length} client{claimed.length === 1 ? "" : "s"} · {unclaimed.length} contact{unclaimed.length === 1 ? "" : "s"}</span>
                  ) : null}
                  {focusId && (
                    // The business-list sort control — kept on this same
                    // header line rather than its own row below.
                    <span className="inline-flex shrink-0 overflow-hidden rounded-md border text-[12px]" onClick={(e) => e.stopPropagation()}>
                      {(["score", "name"] as const).map((k) => (
                        <button key={k} onClick={() => setSort(k)} className={`px-2 py-1 font-medium ${sort === k ? "bg-accent-soft text-accent" : "text-muted hover:bg-background"}`}>{k === "score" ? "Score" : "A–Z"}</button>
                      ))}
                    </span>
                  )}
                  {!focusId && (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{t.name}</div>
                      <div className="truncate text-[13px] text-muted">{t.city}, {t.state} · {claimed.length} client{claimed.length === 1 ? "" : "s"} · {unclaimed.length} contact{unclaimed.length === 1 ? "" : "s"}</div>
                    </div>
                  )}
                  <span className="relative flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                    {(t.assignedTo ?? []).length > 0 ? (
                      <span className="flex items-center -space-x-1.5">
                        {(t.assignedTo ?? []).slice(0, 4).map((mid) => <Avatar key={mid} id={mid} size={24} />)}
                        {(t.assignedTo ?? []).length > 4 && <span className="flex h-6 w-6 items-center justify-center rounded-full border bg-background text-[11px] text-muted">+{(t.assignedTo ?? []).length - 4}</span>}
                      </span>
                    ) : canAdmin ? (
                      <span className="text-[13px] text-muted">Unassigned</span>
                    ) : null}
                    {canAdmin && (
                      <>
                        <button onClick={() => setAssignMenu((m) => (m === t.id ? null : t.id))} title="Assign ambassadors"
                          className="ml-1.5 rounded-md border bg-background px-1.5 py-1 text-[13px] text-muted hover:text-foreground"><I.plus /></button>
                        {assignMenu === t.id && (
                          <span className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border bg-surface p-1 shadow-lg">
                            {users.map((u) => {
                              const on = (t.assignedTo ?? []).includes(u.id);
                              return (
                                <button key={u.id} onClick={() => onToggleAssignee(t.id, u.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
                                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-white" : "border-border"}`}>{on && <I.check />}</span>
                                  <Avatar id={u.id} size={18} /> <span className="truncate text-[13px]">{u.name}</span>
                                </button>
                              );
                            })}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  {canAdmin && (
                    <span onClick={(e) => { e.stopPropagation(); onDeleteTerritory(t.id); }} title="Delete territory" className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-danger"><I.trash /></span>
                  )}
                </HeaderTag>
                {open && focusId && (
                  <TerritoryDirectory city={t.city} state={t.state} contacts={matched} clients={clients} onAddContact={onAddContact}
                    onSyncClients={onSyncClients} onSetStatus={onSetStatus} onOpenClient={onOpenClient}
                    featuredClientIds={featuredClientIds} onFeature={onFeature} sort={sort} onSetSort={setSort} />
                )}
                {open && !focusId && (
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
  );
}
