"use client";

// Clients as records: adding one from GoHighLevel or from a synced contact,
// renaming and deleting, the Trash in Settings, and finding and merging
// duplicates. Lifted out of Cockpit.tsx unchanged (audit 2026-09-29, 3.4).

import * as React from "react";
import { type ConfirmSpec, type PromptSpec } from "./modals";
import { newId } from "./ui";
import { clientContactIds, findDuplicateTrackedClient as findDuplicateClient } from "@/lib/clientDedup";
import { type Client, type ClientLink, type ClientNote, type ClientType, type Contact, type Folder, type Me, type Message, type Notification, type Project, type Task, type VaultFolder } from "@/lib/data";
import { deleteClientDb, fetchAll, hardDeleteClientDb, hardDeleteProjectDb, hardDeleteTaskDb, mergeClientsDb, restoreClientDb, restoreProjectDb, restoreTaskDb, saveTaskEdit, upsertClient, upsertContact, upsertProject } from "@/lib/db";
import { authedFetch } from "@/lib/supabase";

export type UseClientAdminDeps = {
  subAccounts: Client[];
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  clients: Client[];
  setActiveClient: React.Dispatch<React.SetStateAction<string>>;
  setMyWork: React.Dispatch<React.SetStateAction<boolean>>;
  setPersonalView: React.Dispatch<React.SetStateAction<boolean>>;
  setInboxView: React.Dispatch<React.SetStateAction<boolean>>;
  setDmUserId: React.Dispatch<React.SetStateAction<string | null>>;
  setSettingsView: React.Dispatch<React.SetStateAction<boolean>>;
  setDirView: React.Dispatch<React.SetStateAction<"clients" | "projects" | null>>;
  setAddClientOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pushToast: (text: string, action?: { label: string; run: () => void; }, secondaryAction?: { label: string; run: () => void; }) => void;
  clientById: (id: string) => Client | null;
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  markOwnClientWrite: (id: string) => Map<string, number>;
  tasks: Task[];
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  me: Me;
  setPromptDialog: React.Dispatch<React.SetStateAction<PromptSpec | null>>;
  setConfirmDialog: React.Dispatch<React.SetStateAction<ConfirmSpec | null>>;
  setClientLinks: React.Dispatch<React.SetStateAction<ClientLink[]>>;
  setClientNotes: React.Dispatch<React.SetStateAction<ClientNote[]>>;
  activeClient: string;
  contactById: (id: string | null) => Contact | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setVaultFolders: React.Dispatch<React.SetStateAction<VaultFolder[]>>;
  setNotifications: React.Dispatch<React.SetStateAction<Notification[]>>;
  syncMarks: React.RefObject<Partial<Record<import("@/lib/db").SyncTable, string>>>;
  olderTasksLoaded: React.RefObject<Set<string>>;
  resetConversations: () => void;
};

export function useClientAdmin({ subAccounts, setContacts, clients, setActiveClient, setMyWork, setPersonalView, setInboxView, setDmUserId, setSettingsView, setDirView, setAddClientOpen, pushToast, clientById, setClients, markOwnClientWrite, tasks, projects, setProjects, setTasks, me, setPromptDialog, setConfirmDialog, setClientLinks, setClientNotes, activeClient, contactById, setMessages, setFolders, setVaultFolders, setNotifications, syncMarks, olderTasksLoaded, resetConversations }: UseClientAdminDeps) {
  // Someone found live in GoHighLevel who has never been synced here. The
  // local contact row has to exist first: a client's id is `cl_<contactId>`,
  // so without it the client would point at a contact that isn't there.
  //
  // ct_ghl_<id> matches the id the bulk sync builds, so when that sub-account
  // next syncs it updates this row rather than creating a second copy of the
  // same person.
  const addRemoteContact = async (hit: { ghlContactId: string; locationId: string; name: string; email: string; phone: string; company: string; city: string; state: string }) => {
    const sub = subAccounts.find((sa) => sa.ghlLocationId === hit.locationId);
    const contact: Contact = {
      id: `ct_ghl_${hit.ghlContactId}`,
      clientId: sub?.id ?? "",
      name: hit.name, email: hit.email, phone: hit.phone,
      ghlContactId: hit.ghlContactId, company: hit.company, city: hit.city, state: hit.state,
    };
    setContacts((cs) => (cs.some((c) => c.id === contact.id) ? cs.map((c) => (c.id === contact.id ? contact : c)) : [...cs, contact]));
    await upsertContact(contact);
    await addClientContact(contact);
  };

  const addClientContact = async (contact: Contact, type: ClientType = "client") => {
    const id = "cl_" + contact.id;
    if (clients.some((c) => c.id === id)) { setActiveClient(id); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setAddClientOpen(false); return; }
    // Prevent a duplicate: if this contact matches a client we already track
    // (same email/phone/name, e.g. the same business in the other GHL
    // account), link it to that one and open it instead of making a second.
    const dupe = findDuplicateTrackedClient(contact);
    if (dupe) {
      linkContactToClient(dupe, contact.id);
      setActiveClient(dupe); setMyWork(false); setPersonalView(false); setInboxView(false); setDmUserId(null); setSettingsView(false); setDirView(null); setAddClientOpen(false);
      pushToast(`${contact.name} is already tracked as “${clientById(dupe)?.name}” — linked to it.`);
      return;
    }
    const sub = subAccounts.find((s) => s.id === contact.clientId);
    const c: Client = { id, name: contact.name, color: sub?.color ?? "#a855f7", ghlLocationId: "", status: "claimed", type, assignedTo: [] };
    setClients((cs) => [...cs, c]);
    markOwnClientWrite(c.id);
    upsertClient(c);
    // Bring any of this contact's stranded conversation onto the new client's
    // page — inbound created a Conversation task under the GHL sub-account
    // before they were a tracked client. Re-point those tasks (by contact_id)
    // to the new client + a project under it.
    const orphanTasks = tasks.filter((t) => t.contactId === contact.id && t.clientId !== id);
    if (orphanTasks.length) {
      let projId = projects.find((p) => p.clientId === id)?.id;
      if (!projId) {
        const np: Project = { id: newId("p_"), clientId: id, name: "Tasks", description: "" };
        setProjects((ps) => [...ps, np]); upsertProject(np); projId = np.id;
      }
      const pid = projId;
      const orphanIds = new Set(orphanTasks.map((t) => t.id));
      setTasks((ts) => ts.map((t) => (orphanIds.has(t.id) ? { ...t, clientId: id, projectId: pid } : t)));
      orphanTasks.forEach((t) => void saveTaskEdit(t, { ...t, clientId: id, projectId: pid }, me.id));
    }
    setActiveClient(id);
    setMyWork(false);
    setPersonalView(false);
    pushToast(orphanTasks.length ? `Added ${contact.name} — brought ${orphanTasks.length} conversation task${orphanTasks.length === 1 ? "" : "s"} over.` : `Added ${contact.name}`);
    try {
      const res = await authedFetch("/api/ghl/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locationId: sub?.ghlLocationId ?? "", contactId: contact.ghlContactId }) });
      const j = await res.json();
      if (j.company) { const up: Client = { ...c, ghlLocationId: j.company }; setClients((cs) => cs.map((x) => (x.id === id ? up : x))); markOwnClientWrite(up.id); upsertClient(up); }
    } catch { /* business name is optional */ }
  };
  const renameClient = (id: string) => {
    const c = clientById(id);
    if (!c) return;
    setPromptDialog({ title: "Rename client", initial: c.name, confirmLabel: "Rename", onSubmit: (name) => {
      setPromptDialog(null);
      const nc = { ...c, name };
      setClients((cs) => cs.map((x) => (x.id === id ? nc : x)));
      markOwnClientWrite(nc.id);
      upsertClient(nc);
    } });
  };
  const deleteClient = (id: string) => {
    const c = clientById(id);
    const n = tasks.filter((t) => t.clientId === id).length;
    setConfirmDialog({
      title: `Remove “${c?.name}”?`,
      message: `${n ? `This also moves its ${n} task${n === 1 ? "" : "s"} to Trash. ` : ""}Restorable from Trash for 30 days. The GoHighLevel contact itself stays untouched.`,
      confirmLabel: "Remove",
      onConfirm: () => {
        setConfirmDialog(null);
        setClients((cs) => cs.filter((x) => x.id !== id));
        setProjects((ps) => ps.filter((p) => p.clientId !== id));
        setTasks((ts) => ts.filter((t) => t.clientId !== id));
        setClientLinks((ls) => ls.filter((l) => l.clientId !== id));
        setClientNotes((ns) => ns.filter((n) => n.clientId !== id));
        deleteClientDb(id, me.id);
        if (activeClient === id) setActiveClient("all");
      },
    });
  };

  // --- Trash (Settings tab) -----------------------------------------------
  // Restoring only ever affects clients/projects/tasks (the three tables
  // soft-delete covers — see soft-delete.sql), so a targeted re-fetch of
  // just those three is enough; no need for a full fetchAll()-and-replace-
  // everything reload.
  const refreshTrashables = async () => {
    const d = await fetchAll();
    setClients(d.clients); setProjects(d.projects); setTasks(d.tasks);
  };
  const restoreClient = async (id: string) => { await restoreClientDb(id); await refreshTrashables(); pushToast("Client restored"); };
  const restoreProjectFromTrash = async (id: string) => { await restoreProjectDb(id); await refreshTrashables(); pushToast("Project restored"); };
  const restoreTaskFromTrash = async (id: string) => { await restoreTaskDb(id); await refreshTrashables(); pushToast("Task restored"); };
  const purgeClient = async (id: string) => { await hardDeleteClientDb(id); };
  const purgeProject = async (id: string) => { await hardDeleteProjectDb(id); };
  const purgeTask = async (id: string) => { await hardDeleteTaskDb(id); };

  // --- client dedup + merge ------------------------------------------------
  // The same real business can be a contact in more than one GHL sub-account
  // (agency + directory); if each got promoted, you'd get two client records
  // for one entity. These find likely duplicates (by email / phone / name)
  // and fold one into the other.
  // The rule itself lives in lib/clientDedup.ts, where it can be tested: it
  // decides whether importing a contact folds into an existing client or
  // creates a second record for the same business, and a wrong merge costs far
  // more to undo than a duplicate costs to spot.
  const findDuplicateTrackedClient = (contact: Contact): string | null =>
    findDuplicateClient(contact, clients, (id) => contactById(id));
  // Associate an extra contact's future inbound with an existing client
  // (append to linked_contact_ids) without creating a new client record.
  const linkContactToClient = (clientId: string, contactId: string) => {
    const cl = clientById(clientId);
    if (!cl) return;
    if (clientContactIds(cl).includes(contactId)) return;
    const up: Client = { ...cl, linkedContactIds: [...(cl.linkedContactIds ?? []), contactId] };
    setClients((cs) => cs.map((x) => (x.id === clientId ? up : x)));
    markOwnClientWrite(clientId);
    upsertClient(up);
  };
  // Fold source client into target: repoint everything (via the atomic
  // merge_clients RPC), apply the chosen winning field values to the
  // survivor, and reflect it all optimistically. Irreversible — callers
  // gate it behind a confirm (see MergeClientModal).
  const mergeClients = async (sourceId: string, targetId: string, survivorPatch: Partial<Client>) => {
    const source = clientById(sourceId);
    const target = clientById(targetId);
    if (!source || !target || sourceId === targetId) return;
    const absorbed = Array.from(new Set([
      ...(target.linkedContactIds ?? []),
      ...(source.linkedContactIds ?? []),
      ...(source.linkedContactId ? [source.linkedContactId] : []),
      ...(sourceId.startsWith("cl_") ? [sourceId.slice(3)] : []),
    ].filter(Boolean)));
    const survivor: Client = { ...target, ...survivorPatch, linkedContactIds: absorbed };
    // Optimistic repoint of every client-scoped array (contacts intentionally
    // NOT repointed — a contact's client_id is its GHL sub-account; see RPC).
    setTasks((ts) => ts.map((t) => (t.clientId === sourceId ? { ...t, clientId: targetId } : t)));
    setProjects((ps) => ps.map((p) => (p.clientId === sourceId ? { ...p, clientId: targetId } : p)));
    setMessages((ms) => ms.map((m) => (m.clientId === sourceId ? { ...m, clientId: targetId } : m)));
    setClientLinks((ls) => ls.map((l) => (l.clientId === sourceId ? { ...l, clientId: targetId } : l)));
    setClientNotes((ns) => ns.map((n) => (n.clientId === sourceId ? { ...n, clientId: targetId } : n)));
    setFolders((fs) => fs.map((f) => (f.clientId === sourceId ? { ...f, clientId: targetId } : f)));
    setVaultFolders((vs) => vs.map((v) => (v.clientId === sourceId ? { ...v, clientId: targetId } : v)));
    setNotifications((ns) => ns.map((n) => (n.clientId === sourceId ? { ...n, clientId: targetId } : n)));
    setClients((cs) => cs.filter((c) => c.id !== sourceId).map((c) => (c.id === targetId ? survivor : c)));
    if (activeClient === sourceId) setActiveClient(targetId);
    markOwnClientWrite(targetId);
    const { error } = await mergeClientsDb(sourceId, targetId);
    if (error) {
      pushToast(`Merge failed: ${error.message}. Reloading…`);
      try {
        const d = await fetchAll();
        syncMarks.current = d.marks; olderTasksLoaded.current.clear();
        setClients(d.clients); setProjects(d.projects); setContacts(d.contacts); setTasks(d.tasks);
        setMessages(d.messages); resetConversations(); setClientLinks(d.clientLinks); setClientNotes(d.clientNotes);
        setFolders(d.folders); setVaultFolders(d.vaultFolders); setNotifications(d.notifications);
      } catch { /* leave optimistic state; a reload will reconcile */ }
      return;
    }
    // The RPC only set linked_contact_ids on the survivor — write the chosen
    // display fields (name/status/color/etc.) too.
    upsertClient(survivor);
    pushToast(`Merged “${source.name}” into “${target.name}”.`);
  };
  return { restoreClient, restoreProjectFromTrash, restoreTaskFromTrash, purgeClient, purgeProject, purgeTask, renameClient, deleteClient, addClientContact, addRemoteContact, mergeClients };
}
