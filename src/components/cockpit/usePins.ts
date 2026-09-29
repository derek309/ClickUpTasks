"use client";

// Pinned clients and lists, and how the client list is ordered: one person's
// own preferences, lifted out of Cockpit.tsx unchanged (audit 2026-09-29, 3.4).
//
// Pins live in the database (supabase/pins.sql) and in localStorage. The
// localStorage copy is what seeds them on the next mount before /api/pins
// answers, and the one-time migration off localStorage runs from whichever
// context still has the old values, so nobody's pins vanish. Sort, manual order
// and "recently used" are per browser only.
import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase";
import { afterFirstFrame } from "@/lib/usePersisted";

export type ClientSort = "manual" | "az" | "tasks" | "recent" | "used" | "urgent" | "mine";
type PinKind = "client" | "list";

export function usePins(activeClient: string) {
  // Clients directory opens A-Z by default (Derek's preference); a saved
  // "cut_clientSort" still overrides this on load.
  const [clientSort, setClientSort] = useState<ClientSort>("az");
  // Recently-used ordering: clientId → last-opened epoch, persisted locally.
  // Opening a client stamps it (see the effect below), floating it to the top
  // when the "Recently used" sort is active.
  const [clientUsed, setClientUsed] = useState<Record<string, number>>({});
  const [starred, setStarred] = useState<Set<string>>(new Set());
  // Per-user pinned lists (projects), mirroring `starred` for clients — a
  // starred list gets its own quick-access row in the sidebar's Pinned section.
  const [starredLists, setStarredLists] = useState<Set<string>>(new Set());
  const [manualOrder, setManualOrder] = useState<string[]>([]);

  // A frame after mount, like the app's other saved preferences: localStorage
  // does not exist in the server render, and setting state straight out of an
  // effect body is what stops the compiler optimising the component.
  useEffect(() => afterFirstFrame(() => {
    let localStarred: string[] = [];
    let localStarredLists: string[] = [];
    try {
      const s = localStorage.getItem("cut_clientSort"); if (s) setClientSort(s as ClientSort);
      const st = localStorage.getItem("cut_starred"); if (st) { localStarred = JSON.parse(st); setStarred(new Set(localStarred)); }
      const stl = localStorage.getItem("cut_starredLists"); if (stl) { localStarredLists = JSON.parse(stl); setStarredLists(new Set(localStarredLists)); }
      const mo = localStorage.getItem("cut_clientOrder"); if (mo) setManualOrder(JSON.parse(mo));
      const cu = localStorage.getItem("cut_clientUsed"); if (cu) setClientUsed(JSON.parse(cu));
    } catch { /* fresh browser */ }
    // Pinned clients/lists used to live only in localStorage — invisible
    // from a cross-origin iframe (the app loaded as a GHL custom menu link
    // gets its own partitioned storage, even though the same login/session
    // works fine there). DB-backed now; this is the one-time migration off
    // localStorage.
    (async () => {
      try {
        const res = await authedFetch("/api/pins");
        if (!res.ok) return;
        const j = await res.json();
        const dbStarred: string[] = j.starredClientIds ?? [];
        const dbStarredLists: string[] = j.starredListIds ?? [];
        if (dbStarred.length || dbStarredLists.length) {
          setStarred(new Set(dbStarred));
          setStarredLists(new Set(dbStarredLists));
        } else if (localStarred.length || localStarredLists.length) {
          authedFetch("/api/pins", {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ starredClientIds: localStarred, starredListIds: localStarredLists }),
          }).catch(() => {});
        }
      } catch { /* pins fetch is best-effort; localStorage values (if any) stay as the local fallback */ }
    })();
  }), []);

  // Stamp a client's last-opened time whenever it becomes the active client,
  // by any path (sidebar, ⌘K, board, deep link) — so "Recently used" ordering
  // reflects real use without threading a call through every open site.
  useEffect(() => {
    if (!activeClient.startsWith("cl_")) return;
    // Deferred a frame: stamping the time is bookkeeping, not something the
    // render that triggered it needs to see, and writing state straight out of
    // an effect body is what makes the compiler give up on the component.
    const r = requestAnimationFrame(() => {
      setClientUsed((m) => { const n = { ...m, [activeClient]: Date.now() }; try { localStorage.setItem("cut_clientUsed", JSON.stringify(n)); } catch {} return n; });
    });
    return () => cancelAnimationFrame(r);
  }, [activeClient]);

  const saveClientSort = (v: ClientSort) => { setClientSort(v); try { localStorage.setItem("cut_clientSort", v); } catch {} };

  // localStorage write kept alongside the DB one — harmless, and it's what
  // still seeds the pins synchronously on the very next mount before the
  // /api/pins fetch above resolves.
  const toggle = (kind: PinKind) => (id: string) => (kind === "client" ? setStarred : setStarredLists)((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id);
    try { localStorage.setItem(kind === "client" ? "cut_starred" : "cut_starredLists", JSON.stringify([...n])); } catch {}
    authedFetch("/api/pins", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [kind === "client" ? "starredClientIds" : "starredListIds"]: [...n] }) }).catch(() => {});
    return n;
  });
  const toggleStar = toggle("client");
  const toggleStarList = toggle("list");

  // Which pin is being dragged, and which row it is currently over. Clients
  // and lists reorder within their own group, which is how they are stored
  // (Derek, 2026-09-28: "can you make it so we can sort the pinned").
  const [dragPin, setDragPin] = useState<string | null>(null);
  const [overPin, setOverPin] = useState<string | null>(null);
  const movePin = (kind: PinKind, dragId: string, overId: string) => {
    const setter = kind === "client" ? setStarred : setStarredLists;
    const key = kind === "client" ? "cut_starred" : "cut_starredLists";
    const field = kind === "client" ? "starredClientIds" : "starredListIds";
    setter((prev) => {
      const ids = [...prev];
      const from = ids.indexOf(dragId), to = ids.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return prev;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      try { localStorage.setItem(key, JSON.stringify(ids)); } catch {}
      authedFetch("/api/pins", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: ids }) }).catch(() => {});
      return new Set(ids);
    });
  };
  const pinDrag = (kind: PinKind, id: string) => ({
    draggable: true,
    onDragStart: () => setDragPin(id),
    onDragEnd: () => { setDragPin(null); setOverPin(null); },
    onDragOver: (e: React.DragEvent) => { if (dragPin && dragPin !== id) { e.preventDefault(); setOverPin(id); } },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragPin) movePin(kind, dragPin, id); setDragPin(null); setOverPin(null); },
    dragging: dragPin === id,
    over: overPin === id && dragPin !== id,
  });

  return { clientSort, saveClientSort, clientUsed, starred, starredLists, manualOrder, toggleStar, toggleStarList, pinDrag };
}
