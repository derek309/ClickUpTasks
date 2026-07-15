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
const STATUSES = ["todo", "in_progress", "review", "done"];
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

// small caches so we can show client/project names
let clientNames = {}, projectNames = {};
async function names() {
  if (Object.keys(clientNames).length) return;
  for (const c of await sb("clients?select=id,name")) clientNames[c.id] = c.name;
  for (const p of await sb("projects?select=id,name")) projectNames[p.id] = p.name;
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
    assignee_id: z.string().optional().describe("roster member id; defaults to unassigned"),
  },
  async ({ client_id, project_id, title, description, due, priority, assignee_id }) => {
    await names();
    if (!clientNames[client_id]) return { content: [{ type: "text", text: `No client ${client_id}.` }] };
    let pid = project_id;
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
    const t = {
      id: rid("t_"), project_id: pid, client_id, title: title.trim(), description: description || "",
      status: "todo", priority: priority || "normal", assignee_id: assignee_id || null,
      contact_id: client_id.startsWith("cl_") ? client_id.slice(3) : null,
      due: due || addDaysIso(todayIso(), 1),
    };
    await sb("tasks", "POST", t);
    return { content: [{ type: "text", text: `Created ${t.id}: "${t.title}" in ${clientNames[client_id]} · due ${t.due} · priority ${t.priority}${t.assignee_id ? "" : " · unassigned"}.` }] };
  });

server.tool("set_task_status",
  "Set a task's status (todo | in_progress | review | done). Use to start or complete work. Completing (done) removes the task from your Claude queue.",
  { id: z.string(), status: z.enum(STATUSES) },
  async ({ id, status }) => {
    const [t] = await sb(`tasks?id=eq.${enc(id)}`, "PATCH", { status });
    let ghl = "";
    if (t?.ghl_task_id) { try { const ok = await pushGhlStatus(t); ghl = ok ? " (synced to GoHighLevel)" : " (GoHighLevel push failed)"; } catch { ghl = " (GoHighLevel push errored)"; } }
    let dq = "";
    if (status === "done") { try { await sb(`claude_queue?task_id=eq.${enc(id)}`, "DELETE"); dq = " (removed from queue)"; } catch { /* queue cleanup best-effort */ } }
    return { content: [{ type: "text", text: `Set ${id} → ${status}.${ghl}${dq}` }] };
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

server.tool("list_queue",
  "List the tasks hand-picked into your Claude Code queue from the app (the “Queue for Claude” star). Start here when asked to “work my queue.”",
  {},
  async () => {
    await names();
    const q = await sb(`claude_queue?select=task_id&order=at.asc`);
    const ids = (q || []).map((r) => r.task_id);
    if (!ids.length) return { content: [{ type: "text", text: "Your Claude queue is empty. (Star a task “Queue for Claude” in the app to add one.)" }] };
    const rows = await sb(`tasks?select=*&id=in.(${ids.map(enc).join(",")})`);
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { content: [{ type: "text", text: `${rows.length} queued task(s):\n\n${rows.map(brief).join("\n\n")}` }] };
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

const NOTE_TYPES = ["meeting", "content", "contact", "deliverable", "note"];

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

await server.connect(new StdioServerTransport());
