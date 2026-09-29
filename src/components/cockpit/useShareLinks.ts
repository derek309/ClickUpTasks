"use client";

// The public share links: a client's "what we need from you" page and one
// list's own page, each made once and reused. Lifted out of Cockpit.tsx
// unchanged (audit 2026-09-29, 3.4).

import * as React from "react";
import { PERSONAL_CLIENT_ID, type Client, type Project } from "@/lib/data";
import { upsertClient, upsertProject } from "@/lib/db";

export type UseShareLinksDeps = {
  clientById: (id: string) => Client | null;
  pushToast: (text: string, action?: { label: string; run: () => void; }, secondaryAction?: { label: string; run: () => void; }) => void;
  canAdmin: boolean;
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  markOwnClientWrite: (id: string) => Map<string, number>;
  projectById: (id: string) => Project | null;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
};

export function useShareLinks({ clientById, pushToast, canAdmin, setClients, markOwnClientWrite, projectById, setProjects }: UseShareLinksDeps) {
  // Public "here's what we need from you" link for this client — see
  // supabase/client-share-token.sql. Unlike copyLink above, this is a share
  // link, not an app deep-link: it needs to keep working (and copy to the
  // same URL) every time it's clicked, so the token is generated once and
  // reused, not regenerated per click. crypto.randomUUID() is fine here —
  // this only needs to be unguessable, not secret from the browser that's
  // about to hand it to the client.
  // projectId is optional — when given, the copied link opens pre-switched
  // to that one list (the public page's own project switcher) instead of
  // the client's merged view. Still the exact same token underneath: a
  // client with several projects gets ONE link to hand out (or bookmark),
  // not a separate one to track per list — the ?project= param is just a
  // convenience starting point, copyable from any project's own menu.
  // Core of copyClientShareLink below, factored out so the task email
  // composer (auto-populating a client link in the draft) can mint/reuse the
  // same token without going through the clipboard. Returns null (and toasts)
  // when a non-admin hits a client with no token yet — same refusal as before.
  const getClientShareUrl = (clientId: string, opts?: { projectId?: string; taskId?: string }): string | null => {
    const c = clientById(clientId);
    if (!c) return null;
    // "Personal" is a pseudo-client every teammate's private tasks share (see
    // PERSONAL_CLIENT_ID) — minting a share token for it would publish every
    // teammate's private list on the public waiting page, since that page
    // selects tasks by client_id. There is no legitimate client to hand this
    // link to, so it's refused outright rather than gated on admin.
    if (clientId === PERSONAL_CLIENT_ID) { pushToast("Personal tasks can't be shared."); return null; }
    if (!c.shareToken && !canAdmin) { pushToast("Ask an admin to create this client's share link first."); return null; }
    const token = c.shareToken ?? crypto.randomUUID().replace(/-/g, "");
    if (!c.shareToken) {
      const nc = { ...c, shareToken: token };
      setClients((cs) => cs.map((x) => (x.id === clientId ? nc : x)));
      markOwnClientWrite(nc.id);
      upsertClient(nc);
    }
    const params = new URLSearchParams();
    if (opts?.projectId) params.set("project", opts.projectId);
    if (opts?.taskId) params.set("task", opts.taskId);
    const qs = params.toString();
    return `${window.location.origin}/waiting/${token}${qs ? `?${qs}` : ""}`;
  };
  // Public "here's what we need from you" link for this client — see
  // supabase/client-share-token.sql. Unlike copyLink above, this is a share
  // link, not an app deep-link: it needs to keep working (and copy to the
  // same URL) every time it's clicked, so the token is generated once and
  // reused, not regenerated per click. crypto.randomUUID() is fine here —
  // this only needs to be unguessable, not secret from the browser that's
  // about to hand it to the client.
  // projectId is optional — when given, the copied link opens pre-switched
  // to that one list (the public page's own project switcher) instead of
  // the client's merged view. Still the exact same token underneath: a
  // client with several projects gets ONE link to hand out (or bookmark),
  // not a separate one to track per list — the ?project= param is just a
  // convenience starting point, copyable from any project's own menu.
  const copyClientShareLink = (clientId: string, projectId?: string) => {
    const url = getClientShareUrl(clientId, { projectId });
    if (!url) return;
    navigator.clipboard?.writeText(url).then(
      () => pushToast(projectId ? "🔗 List link copied — opens straight to this list" : "🔗 Client link copied — shows what we're waiting on them for"),
      () => pushToast("⚠️ Couldn't copy link"),
    );
  };
  // Real per-project link (see supabase/project-share-token.sql) — a
  // DIFFERENT token from the client's own, not a query param on it. Every
  // /api/waiting/[token]/* lookup scopes to this project's id the moment it
  // resolves the token, so there is nothing else for the recipient to reach
  // regardless of what they click or edit in the URL — unlike
  // copyClientShareLink(clientId, projectId) above, whose ?project= is only
  // a starting view within the full client link. Same mint-once-reuse shape
  // as getClientShareUrl (Derek: emailing a list link to outside reviewers
  // was leaking every other list on the client).
  const getProjectShareUrl = (projectId: string): string | null => {
    const p = projectById(projectId);
    if (!p) return null;
    if (!p.shareToken && !canAdmin) { pushToast("Ask an admin to create this list's share link first."); return null; }
    const token = p.shareToken ?? crypto.randomUUID().replace(/-/g, "");
    if (!p.shareToken) {
      const np = { ...p, shareToken: token };
      setProjects((ps) => ps.map((x) => (x.id === projectId ? np : x)));
      upsertProject(np);
    }
    return `${window.location.origin}/waiting/${token}`;
  };
  const copyProjectShareLink = (projectId: string) => {
    const url = getProjectShareUrl(projectId);
    if (!url) return;
    navigator.clipboard?.writeText(url).then(
      () => pushToast("🔗 List link copied — only this list, nothing else on the client"),
      () => pushToast("⚠️ Couldn't copy link"),
    );
  };
  return { getClientShareUrl, copyClientShareLink, copyProjectShareLink };
}
