#!/usr/bin/env node
// ClickUpTasks MCP server — lets Claude Code read and complete your real
// tasks (the same Supabase DB the web app uses). stdio transport.
//
// Env required:
//   CLICKUPTASKS_URL       = your Supabase project URL (NEXT_PUBLIC_SUPABASE_URL)
//   CLICKUPTASKS_KEY       = Supabase service-role key (SUPABASE_SERVICE_ROLE_KEY)
//   CLICKUPTASKS_MEMBER_ID = your roster member id for "my tasks" (default u_derek)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const URL = process.env.CLICKUPTASKS_URL;
const KEY = process.env.CLICKUPTASKS_KEY;
const ME  = process.env.CLICKUPTASKS_MEMBER_ID || "u_derek";
if (!URL || !KEY) { console.error("Set CLICKUPTASKS_URL and CLICKUPTASKS_KEY"); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function sb(path, method = "GET", body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { method, headers: { ...H, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
const enc = encodeURIComponent;
const STATUSES = ["todo", "in_progress", "review", "changes_requested", "done"];
const GHL = "https://services.leadconnectorhq.com";
const SUB2LOC = { c_agency: "7B0Y8xCOblcTHzYnM1Kc", c_directory: "GN4HK1ybbTBWcolEjLHl" };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const toGhlDate = (due) => `${/^\d{4}-\d{2}-\d{2}$/.test(due || "") ? due : new Date().toISOString().slice(0, 10)}T17:00:00.000Z`;
// task.description is now rich-text HTML (the web app's description editor) —
// no DOM available here, so a regex-based strip stands in for htmlToText()
// (src/lib/data.ts) to keep task briefs readable plain text.
const stripHtml = (html) => (html || "")
  .replace(/<\/(p|li|h[1-6]|blockquote)>/gi, "\n")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

// Push a status change to GoHighLevel for a GHL-linked task (best-effort).
async function pushGhlStatus(t) {
  if (!t.ghl_task_id || !t.contact_id) return null;
  const [ct] = await sb(`contacts?select=ghl_contact_id,client_id&id=eq.${enc(t.contact_id)}`);
  if (!ct?.ghl_contact_id) return null;
  const loc = SUB2LOC[ct.client_id];
  const [tok] = await sb(`ghl_tokens?select=token&location_id=eq.${enc(loc || "")}`);
  if (!tok?.token) return null;
  const res = await fetch(`${GHL}/contacts/${ct.ghl_contact_id}/tasks/${t.ghl_task_id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${tok.token}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ title: (t.title || "Untitled task").slice(0, 200), body: t.description || "Created from ClickUpTasks", dueDate: toGhlDate(t.due), completed: t.status === "done" }),
  });
  return res.ok;
}
const nowIso = () => new Date().toISOString();
const rid = (p) => p + Math.random().toString(36).slice(2, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);
function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Small caches so we can show client/project names. Time-boxed rather than
// loaded once for the life of the process: several tools *gate* on these maps
// ("No client X."), so a permanently-cached list makes anything created since
// the server started look nonexistent — which reads as data loss rather than
// as a stale cache, and sends you hunting for a deleter that isn't there.
let clientNames = {}, projectNames = {}, namesAt = 0;
const NAMES_TTL_MS = 30_000;
async function names(force = false) {
  if (!force && namesAt && Date.now() - namesAt < NAMES_TTL_MS) return;
  const fresh = {}, freshProjects = {};
  for (const c of await sb("clients?select=id,name")) fresh[c.id] = c.name;
  for (const p of await sb("projects?select=id,name")) freshProjects[p.id] = p.name;
  clientNames = fresh; projectNames = freshProjects; namesAt = Date.now();
}

// Roster cache — profiles.member_id is the id actually stored in
// tasks.assignee_id (see supabase/auth.sql / member-id-backfill.sql), not
// profiles.id. Any member can be assigned to any client's tasks; this app
// has no per-client membership restriction, so there's nothing meaningful to
// scope list_members by.
let memberNames = {};
async function members() {
  if (Object.keys(memberNames).length) return;
  for (const m of await sb("profiles?select=member_id,name&member_id=not.is.null")) memberNames[m.member_id] = m.name;
}

// Shared by create_task/update_task so a bad assignee_id fails loudly at the
// point of the call instead of silently landing a task unassigned (the
// exact bug this was added to fix). "me" resolves to your own member id —
// the natural thing to type, which previously just no-op'd.
async function resolveAssignee(rawId) {
  if (rawId == null) return { id: null };
  const trimmed = String(rawId).trim();
  if (!trimmed) return { id: null };
  if (trimmed.toLowerCase() === "me") return { id: ME };
  await members();
  if (!memberNames[trimmed]) return { error: `Unknown member id "${trimmed}". Call list_members to see valid ids, or use "me" for yourself.` };
  return { id: trimmed };
}
const brief = (t) => `[${t.id}] ${t.title}\n  status: ${t.status} · priority: ${t.priority} · due: ${t.due || "—"}\n  client: ${clientNames[t.client_id] || t.client_id} · list: ${projectNames[t.project_id] || "—"}`;

const server = new McpServer({ name: "clickuptasks", version: "1.0.0" });

server.tool("list_my_tasks",
  "List tasks assigned to you (or delegated to you via a checklist item). Filter by client name, status, priority. Excludes Done unless include_done.",
  { client: z.string().optional().describe("filter by client name (substring, case-insensitive)"),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(["none","normal","urgent","conversation"]).optional(),
    include_done: z.boolean().optional(),
    limit: z.number().optional() },
  async ({ client, status, priority, include_done, limit }) => {
    await names();
    let q = `tasks?select=*&or=(assignee_id.eq.${ME},delegated_to.cs.[\"${ME}\"])&order=due.asc.nullslast`;
    if (status) q += `&status=eq.${status}`;
    else if (!include_done) q += `&status=neq.done`;
    if (priority) q += `&priority=eq.${priority}`;
    q += `&limit=${limit || 100}`;
    let rows = await sb(q);
    if (client) { const cl = client.toLowerCase(); rows = rows.filter((t) => (clientNames[t.client_id] || "").toLowerCase().includes(cl)); }
    if (!rows.length) return { content: [{ type: "text", text: "No matching tasks." }] };
    return { content: [{ type: "text", text: `${rows.length} task(s):\n\n${rows.map(brief).join("\n\n")}` }] };
  });

server.tool("list_client_tasks",
  "List ALL open tasks under a client (optionally narrowed to one project/list) — not just tasks assigned to you. Use this when working through an entire client's or project's task list end-to-end (e.g. the desktop helper's client/project-level \"Work with Claude\" hand-off), rather than just your own queue. Get ids from list_clients/list_projects.",
  {
    client_id: z.string(),
    project_id: z.string().optional().describe("omit to include every project under this client"),
    include_done: z.boolean().optional(),
    limit: z.number().optional(),
  },
  async ({ client_id, project_id, include_done, limit }) => {
    await names();
    if (!clientNames[client_id]) await names(true);
    if (!clientNames[client_id]) return { content: [{ type: "text", text: `No client ${client_id}.` }] };
    if (project_id && !projectNames[project_id]) await names(true);
    if (project_id && !projectNames[project_id]) return { content: [{ type: "text", text: `No project ${project_id}.` }] };
    let q = `tasks?select=*&client_id=eq.${enc(client_id)}&order=due.asc.nullslast`;
    if (project_id) q += `&project_id=eq.${enc(project_id)}`;
    if (!include_done) q += `&status=neq.done`;
    q += `&limit=${limit || 200}`;
    const rows = await sb(q);
    if (!rows.length) return { content: [{ type: "text", text: "No matching tasks." }] };
    return { content: [{ type: "text", text: `${rows.length} task(s):\n\n${rows.map(brief).join("\n\n")}` }] };
  });

server.tool("get_task",
  "Get one task's full detail: description, checklist (title + done state), links, client/list context.",
  { id: z.string() },
  async ({ id }) => {
    await names();
    const [t] = await sb(`tasks?select=*&id=eq.${enc(id)}`);
    if (!t) return { content: [{ type: "text", text: `No task ${id}.` }] };
    const checklist = (t.subtasks || []).map((s) => ({ title: s.title, done: !!s.done }));
    const links = (t.attachments || []).filter((a) => a.url).map((a) => `  - ${a.name}: ${a.url}`).join("\n");
    const comments = (t.comments || []).filter((c) => c.kind !== "event").slice(-5).map((c) => `  - ${c.body}`).join("\n");
    const text = [
      brief(t),
      t.description ? `\nDescription:\n${stripHtml(t.description)}` : "",
      checklist.length ? `\nChecklist: ${JSON.stringify(checklist)}` : "",
      links ? `\nLinks:\n${links}` : "",
      comments ? `\nRecent comments:\n${comments}` : "",
    ].filter(Boolean).join("\n");
    return { content: [{ type: "text", text }] };
  });

server.tool("create_task",
  "Create a new task under a client (and optionally a specific list/project). Defaults match the app's quick-add: due tomorrow, priority normal — except assignee, which defaults to unassigned since you're creating on the user's behalf, not as yourself. Get ids from list_clients/list_projects.",
  {
    client_id: z.string(),
    project_id: z.string().optional().describe("omit to use (or create) the client's default \"Tasks\" list"),
    title: z.string().min(1),
    description: z.string().optional(),
    due: z.string().optional().describe("yyyy-mm-dd; defaults to tomorrow"),
    priority: z.enum(["none", "normal", "urgent"]).optional().describe("defaults to \"normal\"; \"conversation\" is reserved/auto-created only"),
    assignee_id: z.string().optional().describe("roster member id (get one from list_members), or \"me\" for yourself; defaults to unassigned"),
    waiting_on_client: z.boolean().optional().describe("mark this task as waiting on the client instead of assigned to a teammate; mutually exclusive with assignee_id (forces it unassigned)"),
  },
  async ({ client_id, project_id, title, description, due, priority, assignee_id, waiting_on_client }) => {
    await names();
    if (!clientNames[client_id]) await names(true);
    if (!clientNames[client_id]) return { content: [{ type: "text", text: `No client ${client_id}.` }] };
    let pid = project_id;
    if (pid && !projectNames[pid]) await names(true);
    if (pid && !projectNames[pid]) return { content: [{ type: "text", text: `No project ${pid}.` }] };
    if (!pid) {
      const existing = await sb(`projects?select=id&client_id=eq.${enc(client_id)}&limit=1`);
      if (existing?.length) pid = existing[0].id;
      else {
        pid = rid("p_");
        await sb("projects", "POST", { id: pid, client_id, name: "Tasks", description: "" });
        projectNames[pid] = "Tasks";
      }
    }
    let assigneeIdResolved = null;
    if (waiting_on_client) {
      assigneeIdResolved = null;
    } else {
      const resolved = await resolveAssignee(assignee_id);
      if (resolved.error) return { content: [{ type: "text", text: resolved.error }] };
      assigneeIdResolved = resolved.id;
    }
    const t = {
      id: rid("t_"), project_id: pid, client_id, title: title.trim(), description: description || "",
      status: "todo", priority: priority || "normal", assignee_id: assigneeIdResolved,
      waiting_on_client: Boolean(waiting_on_client),
      contact_id: client_id.startsWith("cl_") ? client_id.slice(3) : null,
      due: due || addDaysIso(todayIso(), 1),
    };
    await sb("tasks", "POST", t);
    await members();
    const assigneeLabel = t.waiting_on_client ? "waiting on client" : (t.assignee_id ? (memberNames[t.assignee_id] || t.assignee_id) : "unassigned");
    return { content: [{ type: "text", text: `Created ${t.id}: "${t.title}" in ${clientNames[client_id]} · due ${t.due} · priority ${t.priority} · assignee: ${assigneeLabel}.` }] };
  });

server.tool("update_task",
  "Edit an existing task's title, description, priority, due date, or assignee. Only the fields you pass are changed. Get the id from get_task/list_my_tasks.",
  {
    id: z.string(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: z.enum(["none", "normal", "urgent"]).optional().describe("\"conversation\" is reserved/auto-created only, can't be set manually"),
    due: z.string().nullable().optional().describe("yyyy-mm-dd, or null to clear the due date"),
    assignee_id: z.string().nullable().optional().describe("roster member id (get one from list_members), \"me\" for yourself, or null to unassign"),
    waiting_on_client: z.boolean().optional().describe("mark this task as waiting on the client instead of assigned to a teammate; mutually exclusive with assignee_id (forces it unassigned). Passing assignee_id instead clears this back to false."),
  },
  async ({ id, title, description, priority, due, assignee_id, waiting_on_client }) => {
    const patch = {};
    if (title !== undefined) patch.title = title.trim();
    if (description !== undefined) patch.description = description;
    if (priority !== undefined) patch.priority = priority;
    if (due !== undefined) patch.due = due;
    if (assignee_id !== undefined) {
      const resolved = await resolveAssignee(assignee_id);
      if (resolved.error) return { content: [{ type: "text", text: resolved.error }] };
      patch.assignee_id = resolved.id;
      patch.waiting_on_client = false;
    }
    if (waiting_on_client !== undefined) {
      patch.waiting_on_client = waiting_on_client;
      // Setting the flag clears the assignee (mirrors the app); clearing it
      // just drops the flag and leaves assignment to an explicit assignee_id.
      if (waiting_on_client) patch.assignee_id = null;
    }
    if (!Object.keys(patch).length) return { content: [{ type: "text", text: "Nothing to update — provide at least one field." }] };
    const [t] = await sb(`tasks?id=eq.${enc(id)}`, "PATCH", patch);
    if (!t) return { content: [{ type: "text", text: `No task ${id}.` }] };
    let ghl = "";
    if (t.ghl_task_id) { try { const ok = await pushGhlStatus(t); ghl = ok ? " (synced to GoHighLevel)" : " (GoHighLevel push failed)"; } catch { ghl = " (GoHighLevel push errored)"; } }
    await members();
    const changed = Object.keys(patch)
      .filter((k) => k !== "waiting_on_client" || patch.assignee_id === undefined)
      .map((k) => k === "assignee_id" ? `assignee: ${patch.waiting_on_client ? "waiting on client" : (patch.assignee_id ? (memberNames[patch.assignee_id] || patch.assignee_id) : "unassigned")}` : `${k}: ${JSON.stringify(patch[k])}`)
      .join(", ");
    return { content: [{ type: "text", text: `Updated ${id} — ${changed}.${ghl}` }] };
  });

server.tool("delete_task",
  "Permanently delete a task — cannot be undone, always confirm with the user first. Does NOT delete its mirror in GoHighLevel if it has one.",
  { id: z.string() },
  async ({ id }) => {
    const [t] = await sb(`tasks?select=id,title&id=eq.${enc(id)}`);
    if (!t) return { content: [{ type: "text", text: `No task ${id}.` }] };
    await sb(`tasks?id=eq.${enc(id)}`, "DELETE");
    return { content: [{ type: "text", text: `Deleted ${id}: "${t.title}".` }] };
  });

server.tool("set_task_status",
  "Set a task's status (todo | in_progress | review | changes_requested | done). Use to start or complete work.",
  { id: z.string(), status: z.enum(STATUSES) },
  async ({ id, status }) => {
    const [t] = await sb(`tasks?id=eq.${enc(id)}`, "PATCH", { status });
    let ghl = "";
    if (t?.ghl_task_id) { try { const ok = await pushGhlStatus(t); ghl = ok ? " (synced to GoHighLevel)" : " (GoHighLevel push failed)"; } catch { ghl = " (GoHighLevel push errored)"; } }
    return { content: [{ type: "text", text: `Set ${id} → ${status}.${ghl}` }] };
  });

server.tool("add_comment",
  "Add a progress comment to a task (logged as you).",
  { id: z.string(), text: z.string() },
  async ({ id, text }) => {
    const [t] = await sb(`tasks?select=comments&id=eq.${enc(id)}`);
    if (!t) return { content: [{ type: "text", text: `No task ${id}.` }] };
    const comments = [...(t.comments || []), { id: rid("cm_"), authorId: ME, body: text, at: nowIso() }];
    await sb(`tasks?id=eq.${enc(id)}`, "PATCH", { comments });
    return { content: [{ type: "text", text: `Comment added to ${id}.` }] };
  });

// Blank-line-separated paragraphs -> <p> tags, matching the web app's own
// plainTextToHtml (src/lib/data.ts) so a draft opens correctly in the task
// drawer's rich-text review panel — this script has no import access to
// that app code, so it's a small standalone copy, not a shared function.
const draftPlainTextToHtml = (text) => {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
};

server.tool("draft_email",
  "Prepare an email on a task for a human to review and send — never sends anything itself. The draft appears in the task's own review panel in the app (subject + body, editable), where a teammate edits if needed and hits Send. Calling this again on the same task replaces the pending draft rather than adding a second one. Body should be plain text (paragraphs separated by a blank line) — it's converted to formatted HTML for the review panel.",
  { id: z.string(), subject: z.string(), body: z.string() },
  async ({ id, subject, body }) => {
    const [t] = await sb(`tasks?select=id&id=eq.${enc(id)}`);
    if (!t) return { content: [{ type: "text", text: `No task ${id}.` }] };
    const draft_email = { subject, body: draftPlainTextToHtml(body), createdAt: nowIso() };
    await sb(`tasks?id=eq.${enc(id)}`, "PATCH", { draft_email });
    return { content: [{ type: "text", text: `Draft email saved on ${id} — waiting for review in the app.` }] };
  });

server.tool("check_item",
  "Tick (or untick) a checklist item on a task by matching its title text.",
  { id: z.string(), item: z.string().describe("checklist item title (substring)"), done: z.boolean().optional() },
  async ({ id, item, done }) => {
    const [t] = await sb(`tasks?select=subtasks&id=eq.${enc(id)}`);
    if (!t) return { content: [{ type: "text", text: `No task ${id}.` }] };
    const it = item.toLowerCase();
    let hit = null;
    const subtasks = (t.subtasks || []).map((s) => (!hit && s.title.toLowerCase().includes(it) ? (hit = s, { ...s, done: done ?? true }) : s));
    if (!hit) return { content: [{ type: "text", text: `No checklist item matching "${item}".` }] };
    await sb(`tasks?id=eq.${enc(id)}`, "PATCH", { subtasks });
    return { content: [{ type: "text", text: `Checklist "${hit.title}" → ${done ?? true ? "done" : "open"}.` }] };
  });

server.tool("add_checklist_items",
  "Add one or more unchecked checklist items to a task, in the order given. Creates the checklist if the task has none yet. Check get_task first to see what's already there and avoid duplicates.",
  { id: z.string(), items: z.array(z.string()).min(1).describe("item titles to add, unchecked") },
  async ({ id, items }) => {
    const [t] = await sb(`tasks?select=subtasks&id=eq.${enc(id)}`);
    if (!t) return { content: [{ type: "text", text: `No task ${id}.` }] };
    const titles = items.map((s) => s.trim()).filter(Boolean);
    if (!titles.length) return { content: [{ type: "text", text: "No items to add." }] };
    const added = titles.map((title) => ({ id: rid("s_"), title, done: false }));
    const subtasks = [...(t.subtasks || []), ...added];
    await sb(`tasks?id=eq.${enc(id)}`, "PATCH", { subtasks });
    const summary = added.map((s) => ({ id: s.id, title: s.title }));
    return { content: [{ type: "text", text: `Added ${added.length} checklist item(s) to ${id}: ${JSON.stringify(summary)}` }] };
  });

server.tool("list_members",
  "List team members (roster) so you know what a valid assignee_id looks like for create_task/update_task. Any member can be assigned to any client's tasks — there's no per-client membership restriction in this app.",
  {},
  async () => {
    const rows = await sb("profiles?select=member_id,name,email,role&member_id=not.is.null&order=name");
    if (!rows.length) return { content: [{ type: "text", text: "No team members found." }] };
    for (const m of rows) memberNames[m.member_id] = m.name;
    return { content: [{ type: "text", text: rows.map((m) => `${m.name}  [${m.member_id}]  · ${m.role}${m.email ? ` · ${m.email}` : ""}`).join("\n") }] };
  });

server.tool("list_clients",
  "List all clients (name and id) so you can filter tasks by client.",
  {},
  async () => {
    await names();
    const rows = await sb("clients?select=id,name&order=name");
    return { content: [{ type: "text", text: rows.map((c) => `${c.name}  [${c.id}]`).join("\n") }] };
  });

server.tool("list_projects",
  "List projects (lists) and the id of the client each belongs to, so you can filter list_notes/add_note by project.",
  { client: z.string().optional().describe("filter by client name (substring, case-insensitive)") },
  async ({ client }) => {
    await names();
    let rows = await sb("projects?select=id,name,client_id&order=name");
    if (client) { const cl = client.toLowerCase(); rows = rows.filter((p) => (clientNames[p.client_id] || "").toLowerCase().includes(cl)); }
    if (!rows.length) return { content: [{ type: "text", text: "No matching projects." }] };
    return { content: [{ type: "text", text: rows.map((p) => `${p.name}  [${p.id}]  · ${clientNames[p.client_id] || p.client_id}`).join("\n") }] };
  });

const NOTE_TYPES = ["meeting", "decision", "note"];

server.tool("list_notes",
  "Read the Knowledge chat feed for a client or a specific project within it (get ids from list_clients/list_projects). This is the team's running chat — meeting notes, decisions, FYIs — not task comments (see get_task for those).",
  { client_id: z.string(), project_id: z.string().optional().describe("omit for the client-wide feed; set for one project's feed") },
  async ({ client_id, project_id }) => {
    let q = `client_notes?select=*&client_id=eq.${enc(client_id)}&order=created_at.asc`;
    q += project_id ? `&project_id=eq.${enc(project_id)}` : `&project_id=is.null`;
    const rows = await sb(q);
    if (!rows.length) return { content: [{ type: "text", text: "No messages yet in this feed." }] };
    return { content: [{ type: "text", text: rows.map((n) => `[${n.type}] ${n.body}  (by ${n.author_id || "unknown"}, ${n.created_at})`).join("\n\n") }] };
  });

server.tool("add_note",
  "Post a message into the Knowledge chat feed for a client or project (get ids from list_clients/list_projects) — meeting notes, decisions, anything the team should see. Logged as you.",
  { client_id: z.string(), project_id: z.string().optional(), type: z.enum(NOTE_TYPES).optional().describe("defaults to \"note\""), body: z.string() },
  async ({ client_id, project_id, type, body }) => {
    await sb("client_notes", "POST", { id: rid("cn_"), client_id, project_id: project_id || null, type: type || "note", body, author_id: ME, created_at: nowIso() });
    return { content: [{ type: "text", text: `Posted to ${project_id ? "project" : "client"} feed.` }] };
  });

server.tool("list_links",
  "List a client's quick links — websites, Google Drive folders, anything URL-based the team keeps handy. Get client_id from list_clients.",
  { client_id: z.string() },
  async ({ client_id }) => {
    await names();
    if (!clientNames[client_id]) await names(true);
    if (!clientNames[client_id]) return { content: [{ type: "text", text: `No client ${client_id}.` }] };
    const rows = await sb(`client_links?select=label,url,group_label&client_id=eq.${enc(client_id)}&order=position.asc`);
    if (!rows.length) return { content: [{ type: "text", text: "No links yet." }] };
    return { content: [{ type: "text", text: rows.map((l) => `${l.group_label ? `[${l.group_label}] ` : ""}${l.label}: ${l.url}`).join("\n") }] };
  });

server.tool("get_client_overview",
  "One-shot orientation on a client: status, cached AI summary, recent journal notes, quick links (websites/Drive folders), and open task count. Use this before working on a client instead of piecing it together from list_clients + list_notes + list_links + list_client_tasks separately.",
  { client_id: z.string() },
  async ({ client_id }) => {
    const [client] = await sb(`clients?select=name,status,ai_summary,ai_summary_at&id=eq.${enc(client_id)}`);
    if (!client) return { content: [{ type: "text", text: `No client ${client_id}.` }] };
    const [notes, links, openTasks] = await Promise.all([
      sb(`client_notes?select=type,body,created_at&client_id=eq.${enc(client_id)}&project_id=is.null&order=created_at.desc&limit=8`),
      sb(`client_links?select=label,url,group_label&client_id=eq.${enc(client_id)}&order=position.asc`),
      sb(`tasks?select=id&client_id=eq.${enc(client_id)}&status=neq.done`),
    ]);
    const text = [
      `${client.name} — status: ${client.status ?? "unknown"} · ${openTasks.length} open task(s)`,
      client.ai_summary ? `\nAI summary (as of ${client.ai_summary_at || "?"}):\n${client.ai_summary}` : "",
      links.length ? `\nLinks:\n${links.map((l) => `  - ${l.group_label ? `[${l.group_label}] ` : ""}${l.label}: ${l.url}`).join("\n")}` : "",
      notes.length ? `\nRecent journal notes (newest first):\n${notes.map((n) => `  - [${n.type}] ${(n.body || "").slice(0, 300)} (${n.created_at})`).join("\n")}` : "",
    ].filter(Boolean).join("\n");
    return { content: [{ type: "text", text }] };
  });

await server.connect(new StdioServerTransport());
