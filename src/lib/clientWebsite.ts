// A client's WordPress site, and putting a task's picture into its Media
// Library (Derek, 2026-10-12: "when images are attached to a task, get them
// uploaded to the media storage or website so we can use them without doing
// it manually"). WordPress's own media address, signed in with a username and
// an Application Password; nothing on the site to install. Server only: the
// password never reaches the browser (supabase/client-websites.sql).
import { supabaseAdmin } from "./supabaseAdmin";
import type { Attachment } from "./data";

export type ClientSite = { url: string; user: string; password: string };

/** "example.com/" → "https://example.com". */
export function siteBase(raw: string): string | null {
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
}

const authHeader = (s: ClientSite) => `Basic ${Buffer.from(`${s.user}:${s.password.replace(/\s+/g, "")}`).toString("base64")}`;

export async function clientSite(clientId: string): Promise<ClientSite | null> {
  const { data } = await supabaseAdmin.from("client_websites").select("site_url, wp_user, app_password").eq("client_id", clientId).maybeSingle();
  return data ? { url: data.site_url as string, user: data.wp_user as string, password: data.app_password as string } : null;
}

/** Signs in to the site's API: ok, or what went wrong in words. */
export async function checkSite(s: ClientSite): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const res = await fetch(`${s.url}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: authHeader(s), Accept: "application/json" } }).catch(() => null);
  if (!res) return { ok: false, error: "Couldn't reach the site. Check the address." };
  if (res.status === 401 || res.status === 403) return { ok: false, error: "The site didn't accept that username and Application Password." };
  if (!res.ok) return { ok: false, error: `The site answered ${res.status}. Is it WordPress, with its API open?` };
  const j = await res.json().catch(() => ({})) as { name?: string; capabilities?: Record<string, boolean> };
  if (j.capabilities && !j.capabilities.upload_files) return { ok: false, error: "That user can't upload files on the site. Use an Editor or Administrator." };
  return { ok: true, name: j.name ?? s.user };
}

export type WebsiteMedia = { id: number; url: string; at: string };

/** One of a task's stored files, uploaded to the client's site. */
export async function sendAttachmentToSite(clientId: string, att: Attachment): Promise<{ ok: true; media: WebsiteMedia } | { ok: false; error: string }> {
  const site = await clientSite(clientId);
  if (!site) return { ok: false, error: "This client has no website set up yet (Website, under SaaS account on a task)." };
  if (!att.path) return { ok: false, error: "Only a stored file can go to the website, not a link." };
  const { data: blob, error } = await supabaseAdmin.storage.from("task-files").download(att.path);
  if (error || !blob) return { ok: false, error: "Couldn't read the file." };
  const name = att.name.replace(/[^\w.\- ]+/g, "_") || "image";
  const res = await fetch(`${site.url}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: { Authorization: authHeader(site), "Content-Type": att.mimeType || blob.type || "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"` },
    body: Buffer.from(await blob.arrayBuffer()),
  }).catch(() => null);
  if (!res) return { ok: false, error: "Couldn't reach the website." };
  const j = await res.json().catch(() => ({})) as { id?: number; source_url?: string; message?: string };
  if (!res.ok || !j.id) return { ok: false, error: j.message ? `The website said: ${j.message}` : `The website answered ${res.status}.` };
  return { ok: true, media: { id: j.id, url: j.source_url ?? `${site.url}/?attachment_id=${j.id}`, at: new Date().toISOString() } };
}

/** Sends one of a task's files and notes on the task where it went, so the
 *  button can say "On website" and nobody uploads it twice. */
export async function sendTaskFileToSite(taskId: string, fileRef: string): Promise<{ ok: true; media: WebsiteMedia; name: string; already?: boolean } | { ok: false; error: string }> {
  const { data: task } = await supabaseAdmin.from("tasks").select("id, client_id, attachments").eq("id", taskId).is("deleted_at", null).maybeSingle();
  if (!task) return { ok: false, error: "No such task." };
  const atts = (task.attachments ?? []) as (Attachment & { website?: WebsiteMedia })[];
  const ref = fileRef.trim().toLowerCase();
  const att = atts.find((a) => a.id === fileRef.trim()) ?? atts.find((a) => a.name.toLowerCase() === ref);
  if (!att) return { ok: false, error: `No file "${fileRef}" on the task.` };
  if (att.website) return { ok: true, media: att.website, name: att.name, already: true };
  const sent = await sendAttachmentToSite(task.client_id as string, att);
  if (!sent.ok) return sent;
  // Only this attachment changes, read fresh so a file added meanwhile stays.
  const { data: fresh } = await supabaseAdmin.from("tasks").select("attachments").eq("id", taskId).maybeSingle();
  const next = ((fresh?.attachments ?? atts) as (Attachment & { website?: WebsiteMedia })[]).map((a) => (a.id === att.id ? { ...a, website: sent.media } : a));
  await supabaseAdmin.from("tasks").update({ attachments: next, updated_by: null }).eq("id", taskId);
  return { ok: true, media: sent.media, name: att.name };
}
