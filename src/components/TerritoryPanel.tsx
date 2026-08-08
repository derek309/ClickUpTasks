"use client";

// Ambassador territory dashboard: an admin assigns a city+state to a
// teammate, and this panel shows every GHL contact in that city/state split
// into "claimed" (already added as a client — see clients.id = 'cl_'+contact.id)
// vs "unclaimed" (still just a raw synced contact). Reuses the existing client
// status funnel for pipeline stage instead of a second, parallel state.
import { useState } from "react";
import { users, normalizeState, type Me, type Territory, type Contact, type Client, type ClientStatus, type Task } from "@/lib/data";
import { I, Avatar } from "./cockpit/ui";
import TerritoryDirectory from "./cockpit/TerritoryDirectory";

export default function TerritoryPanel({ me, canAdmin, territories, contacts, clients, onAddTerritory, onToggleAssignee, onToggleFollower, onDeleteTerritory, onSetDailyInviteCap, onAddContact, onSyncClients, onOpenClient, featuredClientIds, onFeature, tasksByClient, playbookTasksByClient, onOpenPlaybook, otherListsByClient, onOpenProject, onSetClientStatus, ghlContactUrlFor, focusId, highlightListingId, onHighlightConsumed }: {
  me: Me; canAdmin: boolean;
  territories: Territory[]; contacts: Contact[]; clients: Client[];
  onAddTerritory: (t: { name: string; city: string; state: string; assignedTo: string[] }) => void;
  onToggleAssignee: (id: string, memberId: string) => void; // toggle a teammate on/off a city
  // Toggle a teammate on/off a city's follower list — they can open the city
  // and see its work, but it never puts activities on their own Territory
  // Dashboard the way being an ambassador does.
  onToggleFollower: (id: string, memberId: string) => void;
  onDeleteTerritory: (id: string) => void;
  // How many prospecting invites the auto-invite cron sends per weekday for
  // this city (null/0 = off) — see runPlannerAutoInvite. Optional so the
  // focused single-city page (which never renders this admin-only control)
  // doesn't need to pass it.
  onSetDailyInviteCap?: (id: string, cap: number | null) => void;
  onAddContact: (contact: Contact) => void; // open (existing) or immediately create+open (new) — no confirm
  // Auto-sync + inline stage editing — only reachable via the focused
  // single-city page (see TerritoryDirectory), so optional here: the admin
  // multi-city overview below never sets focusId and never needs them.
  onSyncClients?: (contacts: Contact[]) => void;
  onOpenClient: (clientId: string) => void;
  // Newsletter feature motion, threaded straight through to the city view.
  featuredClientIds?: Set<string>;
  onFeature?: (opts: { clientId: string | null; contact: Contact | null; name: string; city: string; state: string }) => void;
  // Per-business work, surfaced inline on each listing row so you can see
  // what's open across a city without opening every business in turn.
  tasksByClient?: Map<string, Task[]>;
  // Owner Growth Plan tasks per business, and the navigate-to-it handler —
  // same optional-so-the-admin-overview-degrades-gracefully shape as tasksByClient.
  playbookTasksByClient?: Map<string, Task[]>;
  onOpenPlaybook?: (clientId: string) => void;
  // A business's other (non-Playbook) lists, each pre-computed with
  // its own done/total count, and the navigate-to-it handler — one pill per
  // list on the Businesses page instead of one aggregated count.
  otherListsByClient?: Map<string, { id: string; name: string; done: number; total: number }[]>;
  onOpenProject?: (clientId: string, projectId: string) => void;
  // Editable Stage dropdown + GHL contact link on the Businesses page.
  // Optional so the admin multi-city overview (below) — a read-only list —
  // degrades gracefully without them.
  onSetClientStatus?: (id: string, status: ClientStatus) => void;
  ghlContactUrlFor?: (clientId: string) => string | null;
  focusId?: string; // when set, render only this one city, auto-expanded (the sidebar city page)
  // Scrolls straight to this listing on open (Territory Dashboard's "Open in
  // Businesses") — consumed once, then the caller clears it so a later plain
  // sidebar click into the same city doesn't re-trigger the scroll.
  highlightListingId?: number | null;
  onHighlightConsumed?: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [assignSet, setAssignSet] = useState<Set<string>>(new Set());
  const [assignMenu, setAssignMenu] = useState<string | null>(null); // territory id whose assignee popover is open

  const scoped = canAdmin ? territories : territories.filter((t) => (t.assignedTo ?? []).includes(me.id) || (t.followers ?? []).includes(me.id));
  const visible = focusId ? scoped.filter((t) => t.id === focusId) : scoped;
  const clientIds = new Set(clients.map((c) => c.id));
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
            return (
              <div key={t.id} className={focusId ? "" : "mb-2 rounded-xl border"}>
                <div className="flex w-full items-center gap-3 px-1 py-2.5 text-left">
                  <I.flag className="shrink-0 text-accent" />
                  {focusId ? (
                    // The city name/state is already the page's own title
                    // (the app header above) — repeating it here just to add
                    // the scoped counts would duplicate it, so this is one
                    // compact line, not a second stacked title.
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{claimed.length} client{claimed.length === 1 ? "" : "s"} · {unclaimed.length} contact{unclaimed.length === 1 ? "" : "s"}</span>
                  ) : null}
                  {!focusId && (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{t.name}</div>
                      <div className="truncate text-[13px] text-muted">{t.city}, {t.state} · {claimed.length} client{claimed.length === 1 ? "" : "s"} · {unclaimed.length} contact{unclaimed.length === 1 ? "" : "s"}</div>
                    </div>
                  )}
                  <span className="relative flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                    {(t.assignedTo ?? []).length > 0 || (t.followers ?? []).length > 0 ? (
                      <span className="flex items-center -space-x-1.5">
                        {(t.assignedTo ?? []).slice(0, 4).map((mid) => <Avatar key={`a:${mid}`} id={mid} size={24} />)}
                        {/* Followers render dimmed with a dashed ring so the
                            avatar row itself signals "can see, not working
                            it" without needing a legend. */}
                        {(t.followers ?? []).slice(0, 4).map((mid) => (
                          <span key={`f:${mid}`} title="Following (no activities)" className="rounded-full opacity-60 ring-2 ring-dashed ring-background">
                            <Avatar id={mid} size={24} />
                          </span>
                        ))}
                      </span>
                    ) : canAdmin ? (
                      <span className="text-[13px] text-muted">Unassigned</span>
                    ) : null}
                    {canAdmin && (
                      <>
                        <button onClick={() => setAssignMenu((m) => (m === t.id ? null : t.id))} title="Manage ambassadors and followers"
                          className="ml-1.5 rounded-md border bg-background px-1.5 py-1 text-[13px] text-muted hover:text-foreground"><I.plus /></button>
                        {assignMenu === t.id && (
                          <span className="absolute right-0 top-full z-20 mt-1 w-60 rounded-lg border bg-surface p-1 shadow-lg">
                            <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Ambassador — works it, gets activities</div>
                            {users.map((u) => {
                              const on = (t.assignedTo ?? []).includes(u.id);
                              return (
                                <button key={`a:${u.id}`} onClick={() => onToggleAssignee(t.id, u.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
                                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-white" : "border-border"}`}>{on && <I.check />}</span>
                                  <Avatar id={u.id} size={18} /> <span className="truncate text-[13px]">{u.name}</span>
                                </button>
                              );
                            })}
                            <div className="mt-1 border-t px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Following — can look, no activities</div>
                            {users.map((u) => {
                              const on = (t.followers ?? []).includes(u.id);
                              return (
                                <button key={`f:${u.id}`} onClick={() => onToggleFollower(t.id, u.id)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-background">
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
                  {canAdmin && onSetDailyInviteCap && (
                    <span onClick={(e) => e.stopPropagation()} title="Auto-send this many prospecting invites at 9am Pacific, weekdays only, most-overdue first — blank/0 = off" className="flex shrink-0 items-center gap-1">
                      <input type="number" min={0} value={t.dailyInviteCap ?? ""} placeholder="0"
                        onChange={(e) => { const n = e.target.value === "" ? null : Math.max(0, parseInt(e.target.value, 10) || 0); onSetDailyInviteCap(t.id, n); }}
                        className="w-12 rounded-md border bg-background px-1.5 py-1 text-center text-[13px] outline-none focus:border-accent" />
                      <span className="text-[11px] text-muted">invites/day</span>
                    </span>
                  )}
                  {canAdmin && (
                    <span onClick={(e) => { e.stopPropagation(); onDeleteTerritory(t.id); }} title="Delete territory" className="shrink-0 rounded p-1 text-muted hover:bg-background hover:text-danger"><I.trash /></span>
                  )}
                </div>
                {/* The Businesses/City work switch lives in the page header
                    now (Cockpit.tsx), not here — same control, same spot,
                    regardless of which half of the territory is showing.
                    The admin multi-city overview (focusId unset) used to
                    expand into a flat "every contact, + Add as client" list
                    here — a leftover from before the Businesses page and its
                    claim/invite ladder existed. It only duplicated (worse)
                    what "Lincoln, CA" in the sidebar already shows, and read
                    as part of assignment management since it lived in the
                    same row. Removed rather than fixed — nothing in this
                    view needs it anymore. */}
                {focusId && (
                  <TerritoryDirectory city={t.city} state={t.state} contacts={matched} clients={clients} onAddContact={onAddContact}
                    onSyncClients={onSyncClients} onOpenClient={onOpenClient}
                    featuredClientIds={featuredClientIds} onFeature={onFeature}
                    tasksByClient={tasksByClient}
                    playbookTasksByClient={playbookTasksByClient} onOpenPlaybook={onOpenPlaybook}
                    otherListsByClient={otherListsByClient} onOpenProject={onOpenProject}
                    onSetClientStatus={onSetClientStatus} canAdmin={canAdmin} ghlContactUrlFor={ghlContactUrlFor} territoryId={focusId} dailyInviteCap={t.dailyInviteCap}
                    highlightListingId={highlightListingId} onHighlightConsumed={onHighlightConsumed} />
                )}
              </div>
            );
          })}
        </div>
    </div>
  );
}
