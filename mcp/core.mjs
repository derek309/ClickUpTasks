// ClickUpTasks MCP tool definitions — shared by both transports:
//   - mcp/server.mjs (stdio, for Claude Code)
//   - src/app/api/mcp/route.ts (Streamable HTTP, for claude.ai connectors)
// createServer() builds one fully-configured McpServer per call so each
// transport (and, for the HTTP route, each request in stateless mode) gets
// its own isolated name/member caches — no cross-request leakage.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const STATUSES = ["todo", "in_progress", "review", "changes_requested", "waiting", "done"];
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
const nowIso = () => new Date().toISOString();
// Where the client-facing portal lives. Same shape the web app builds in
// getClientShareUrl (src/components/Cockpit.tsx): /waiting/<token>.
const APP_URL = process.env.APP_URL || "https://clickuptasks.vercel.app";
const PERSONAL_CLIENT_ID = "personal";
// 32 hex characters, no dashes — byte-for-byte the format the web app mints,
// so a token created here is indistinguishable from one created there.
const mintShareToken = () => globalThis.crypto.randomUUID().replace(/-/g, "");
const rid = (p) => p + Math.random().toString(36).slice(2, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);
function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
// Blank-line-separated paragraphs -> <p> tags, matching the web app's own
// plainTextToHtml (src/lib/data.ts) so a draft opens correctly in the task
// drawer's rich-text review panel — this script has no import access to
// that app code, so it's a small standalone copy, not a shared function.
const draftPlainTextToHtml = (text) => {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
};
const NOTE_TYPES = ["meeting", "decision", "note"];

// The client review document is stored as HTML the app's editor reads. Claude
// works in plain text with a little markdown, both ways:
//   docTextToHtml  what Claude writes -> document HTML. Every character of input
//                  is escaped first and only these tags are ever produced, so it
//                  is safe without the app's sanitizer (which still runs again
//                  on every save, send and client read).
//   docHtmlToText  document HTML -> the same markdown, so an edit round trips.
// Supported: "## " heading, "### " subheading, "- " bullets, "1. " numbers,
// "> " quote, **bold**, *italic*, [label](https://url). Blank line = new block.
export function docTextToHtml(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (s) => esc(s.trim())
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>");
  const block = (lines) => {
    if (!lines.length) return "";
    const heading = lines[0].match(/^(#{2,3})\s+(.*)$/) || lines[0].match(/^(#)\s+(.*)$/);
    if (heading) {
      const tag = heading[1] === "###" ? "h3" : "h2";
      return `<${tag}>${inline(heading[2])}</${tag}>${block(lines.slice(1))}`;
    }
    if (lines.every((l) => /^[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li><p>${inline(l.replace(/^[-*]\s+/, ""))}</p></li>`).join("")}</ul>`;
    if (lines.every((l) => /^\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li><p>${inline(l.replace(/^\d+[.)]\s+/, ""))}</p></li>`).join("")}</ol>`;
    if (lines.every((l) => /^>\s?/.test(l))) return `<blockquote><p>${lines.map((l) => inline(l.replace(/^>\s?/, ""))).join("<br>")}</p></blockquote>`;
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  };
  return String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)
    .map((b) => block(b.split("\n").map((l) => l.trim()).filter(Boolean))).join("");
}

export function docHtmlToText(html) {
  return (html || "")
    .replace(/<li([^>]*)>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/li>/gi, "<li$1>$2</li>")
    .replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<\/?(strong|b)>/gi, "**")
    .replace(/<\/?(em|i)>/gi, "*")
    .replace(/<h2[^>]*>/gi, "## ").replace(/<h3[^>]*>/gi, "### ")
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => `${inner.replace(/<li[^>]*>/gi, "1. ")}\n`)
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<blockquote[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/blockquote>/gi, (_, inner) => `${inner.split(/<br\s*\/?>/i).map((l) => `> ${l}`).join("\n")}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(p|h2|h3|ul|ol)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @param {{ url?: string, key?: string, memberId?: string, services?: object }} [opts]
 *   Falls back to CLICKUPTASKS_URL/CLICKUPTASKS_KEY/CLICKUPTASKS_MEMBER_ID
 *   env vars when omitted (the stdio server's original behavior). services: the
 *   app's review code (src/lib/mcpReviewServices.ts); the review tools exist only
 *   when it is given, which the hosted server does.
 */
export function createServer(opts = {}) {
  const URL = opts.url || process.env.CLICKUPTASKS_URL;
  const KEY = opts.key || process.env.CLICKUPTASKS_KEY;
  const ME = opts.memberId || process.env.CLICKUPTASKS_MEMBER_ID || "u_derek";
  if (!URL || !KEY) throw new Error("Set CLICKUPTASKS_URL and CLICKUPTASKS_KEY (or pass url/key to createServer).");
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

  async function sb(path, method = "GET", body) {
    const res = await fetch(`${URL}/rest/v1/${path}`, { method, headers: { ...H, Prefer: "return=representation" }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }
  const enc = encodeURIComponent;

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
      priority: z.enum(["none","normal","urgent","conversation","client_request"]).optional(),
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
        // "waiting" status and waiting_on_client always move together (see
        // data.ts's applyWaitingStatusSync) — this tool bypasses that helper
        // (separate Node process, no app import), so it replicates the same
        // invariant inline instead of just setting the flag on its own.
        status: waiting_on_client ? "waiting" : "todo", priority: priority || "normal", assignee_id: assigneeIdResolved,
        waiting_on_client: Boolean(waiting_on_client),
        contact_id: client_id.startsWith("cl_") ? client_id.slice(3) : null,
        due: due || addDaysIso(todayIso(), 1),
        created_by: ME,
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
      // "waiting" status and waiting_on_client always move together (see
      // data.ts's applyWaitingStatusSync) — only fetch the task's current
      // status when a change here could actually cross that boundary, to
      // avoid a round-trip on a plain title/description/due edit.
      let before = null;
      if (assignee_id !== undefined || waiting_on_client !== undefined) {
        [before] = await sb(`tasks?select=status&id=eq.${enc(id)}`);
        if (!before) return { content: [{ type: "text", text: `No task ${id}.` }] };
      }
      if (assignee_id !== undefined) {
        const resolved = await resolveAssignee(assignee_id);
        if (resolved.error) return { content: [{ type: "text", text: resolved.error }] };
        patch.assignee_id = resolved.id;
        patch.waiting_on_client = false;
        if (before.status === "waiting") patch.status = "review";
      }
      if (waiting_on_client !== undefined) {
        patch.waiting_on_client = waiting_on_client;
        // Setting the flag clears the assignee (mirrors the app); clearing it
        // just drops the flag and leaves assignment to an explicit assignee_id.
        if (waiting_on_client) { patch.assignee_id = null; patch.status = "waiting"; }
        else if (before.status === "waiting") patch.status = "review";
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
    "Set a task's status (todo | in_progress | review | changes_requested | waiting | done). Use to start or complete work. Setting \"waiting\" also marks the task waiting on the client (clearing its assignee), same as the app's Waiting column.",
    { id: z.string(), status: z.enum(STATUSES) },
    async ({ id, status }) => {
      const patch = { status };
      // "waiting" status and waiting_on_client always move together (see
      // data.ts's applyWaitingStatusSync) — replicated here since this tool
      // is a separate Node process with no app import.
      if (status === "waiting") { patch.waiting_on_client = true; patch.assignee_id = null; }
      else {
        const [before] = await sb(`tasks?select=status&id=eq.${enc(id)}`);
        if (before?.status === "waiting") patch.waiting_on_client = false;
      }
      const [t] = await sb(`tasks?id=eq.${enc(id)}`, "PATCH", patch);
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

  server.tool("draft_email",
    "Prepare an email on a task for a human to review and send — never sends anything itself. The draft appears in the task's own review panel in the app (subject + body, editable), where a teammate edits if needed and hits Send. A task holds one draft: this won't replace a draft already waiting unless replace is true. Body should be plain text (paragraphs separated by a blank line) — it's converted to formatted HTML for the review panel.",
    { id: z.string(), subject: z.string(), body: z.string(), replace: z.boolean().optional().describe("replace a draft already waiting on the task") },
    async ({ id, subject, body, replace }) => {
      const [t] = await sb(`tasks?select=id&id=eq.${enc(id)}`);
      if (!t) return { content: [{ type: "text", text: `No task ${id}.` }] };
      const now = nowIso();
      const draft_email = { subject, body: draftPlainTextToHtml(body), createdAt: now, updatedAt: now };
      // updated_by null makes a task open in the app pick the draft up live.
      const saved = await sb(`tasks?id=eq.${enc(id)}${replace ? "" : "&draft_email=is.null"}`, "PATCH", { draft_email, updated_by: null });
      if (!saved.length) return { content: [{ type: "text", text: `${id} already has a draft email waiting. Pass replace: true to swap it.` }] };
      return { content: [{ type: "text", text: `Draft email saved on ${id} — waiting for review in the app.` }] };
    });

  // Client reviews on a task: the client document (kind "doc"), the image review
  // ("image") and the HTML review ("page"). The work runs in the app's own review
  // code (src/lib/mcpReviewServices.ts), which the hosted server passes in as
  // opts.services, so these tools only exist there; the local stdio server has none.
  // Claude may send a review, which turns its link on, but the email to the client
  // is only ever a draft a person sends, and Claude's comments never email the client.
  const reply = (text) => ({ content: [{ type: "text", text }] });
  const services = opts.services;
  if (services) {
    const KIND = z.enum(["doc", "image", "page"]).describe('"doc" the client document, "image" the image review, "page" the HTML review');
    const FILE_KIND = z.enum(["image", "page"]).describe('"image" the image review, "page" the HTML review');
    const VERSION = z.union([z.number().int().positive(), z.literal("next")]).describe('a version number from get_review, or "next" for the working copy that has not been sent');
    const DOC_TEXT = "Plain text with simple markdown: \"## \" heading, \"### \" subheading, \"- \" bullets, \"1. \" numbered, \"> \" quote, **bold**, *italic*, [label](https://url); a blank line starts a new paragraph. Merge fields like {{contact.first_name}} are kept as typed.";

    server.tool("list_reviews",
      "What reviews a task has: its client document, image review and HTML review, each with its stage, version, whether the client's link is on and how many comments are open, plus whether a draft email is waiting.",
      { task_id: z.string() },
      async ({ task_id }) => reply(await services.listReviews(task_id)));

    const getReview = async ({ task_id, kind = "doc", include_code }) => reply(await services.getReview(task_id, kind, !!include_code));
    server.tool("get_review",
      `Read one review on a task: stage, version, the client's link, versions (numbered, and "next" for an unsent working copy), the working copy (a document's text in the markdown write_document takes, a page's text or code, a link to see the image), and every comment with its id, pin and done state.`,
      { task_id: z.string(), kind: KIND, include_code: z.boolean().optional().describe("on an HTML review, show the working page's HTML instead of its text") },
      getReview);
    server.tool("get_client_document", "Read a task's client document. The same as get_review with kind \"doc\".", { task_id: z.string() }, getReview);

    server.tool("create_review",
      "Start a review on a task (one of each kind per task). Refused on private and Personal tasks. A new review is named after the task unless title is given.",
      { task_id: z.string(), kind: KIND, title: z.string().optional() },
      async ({ task_id, kind, title }) => reply(await services.createReview(task_id, kind, title)));

    server.tool("update_review",
      "Rename a review, pick its stage by hand, reopen one the client approved so it can change again, or relabel an image review's images. Completed locks it; any stage but approved clears a client approval.",
      {
        task_id: z.string(), kind: KIND,
        title: z.string().optional().describe("the review's name on the task and the client's page; empty uses the task's title"),
        stage: z.enum(["draft", "with_client", "client_submitted", "approved", "completed"]).optional(),
        reopen: z.boolean().optional(),
        image_labels: z.array(z.string()).max(10).optional().describe('image review only: labels for the working copy\'s images in order, like ["Front", "Back"]; "" goes back to the default. The client sees them after the next send'),
      },
      async ({ task_id, kind, image_labels, ...change }) => reply(await services.updateReview(task_id, kind, { ...change, imageLabels: image_labels })));

    const writeDocument = async ({ task_id, body, title }) => {
      const html = docTextToHtml(body);
      if (!docHtmlToText(html)) return reply("The document is empty.");
      return reply(await services.writeDocument(task_id, html, title));
    };
    const writeSchema = {
      task_id: z.string(),
      body: z.string().min(1).describe("the whole document, in the simple markdown described above"),
      title: z.string().optional().describe("the document's name; omit to keep it"),
    };
    const writeWhat = `Create a task's client document, or replace its working copy, as a draft. Pass the WHOLE document every time (read it with get_review first when editing). The client sees it only after send_for_review. ${DOC_TEXT} Refused once the client approved (update_review with reopen first).`;
    server.tool("write_document", writeWhat, writeSchema, writeDocument);
    server.tool("write_client_document", writeWhat, writeSchema, writeDocument);

    server.tool("start_image_upload",
      "For an image file on this computer: a one time upload link. PUT the file's bytes to it (curl works), then call add_review_version with the upload_id it gives. For an image already online, use add_review_version with image_url instead.",
      { task_id: z.string(), file_name: z.string().describe("the image's file name, ending .png, .jpg, .gif or .webp"), size: z.number().int().positive().describe("the file's size in bytes (25 MB at most)") },
      async ({ task_id, file_name, size }) => reply(await services.startImageUpload(task_id, file_name, size)));

    server.tool("add_review_version",
      "Add a new version to an image or HTML review (starting the review if there is none). It becomes the working copy, not sent yet. An image comes from image_url (a public https link to a PNG, JPEG, GIF or WebP) or upload_id (from start_image_upload). One image review version can hold up to 10 images shown stacked, like a postcard's front and back: pass images instead, each with image_url or upload_id and an optional label (two default to Front and Back, more to Image 1, 2, 3). With keep_others, each image replaces the one at its position in the working copy (or is added at the end) and the rest carry over with their pins. A page comes from html: the WHOLE page, up to 2 MB, images linked by web address (read the current code with get_review include_code).",
      {
        task_id: z.string(), kind: FILE_KIND,
        image_url: z.string().url().optional(), upload_id: z.string().optional(),
        images: z.array(z.object({
          image_url: z.string().url().optional(), upload_id: z.string().optional(), name: z.string().optional(),
          label: z.string().optional(), position: z.number().int().min(1).max(10).optional().describe("with keep_others, the image (1 based) this one replaces"),
        })).min(1).max(10).optional(),
        keep_others: z.boolean().optional().describe("keep the working copy's other images and replace or add only these"),
        html: z.string().optional(), name: z.string().optional().describe("the version's file name"),
      },
      async ({ task_id, kind, image_url, upload_id, images, keep_others, html, name }) => reply(await services.addVersion(task_id, kind, {
        imageUrl: image_url, uploadId: upload_id, html, name,
        ...(images ? { images: images.map((i) => ({ imageUrl: i.image_url, uploadId: i.upload_id, name: i.name, label: i.label, position: i.position })), keepOthers: !!keep_others } : {}),
      })));

    server.tool("use_version",
      "Make an earlier version the working copy again (on the client document, bring back an earlier version's text). send_for_review sends it.",
      { task_id: z.string(), kind: KIND, version: VERSION },
      async ({ task_id, kind, version }) => reply(await services.useVersion(task_id, kind, version)));

    server.tool("remove_version",
      "Take a wrong version off an image or HTML review. Its pins go with it; if the client was looking at it, they see the newest version left. On an image review, images this version shares with other versions stay.",
      { task_id: z.string(), kind: FILE_KIND, version: VERSION },
      async ({ task_id, kind, version }) => reply(await services.removeVersion(task_id, kind, version)));

    server.tool("send_for_review",
      "Send a review's working copy to the client as the next version. The first send turns on the client's private link. The task moves to Waiting, and the review email is saved as the task's draft email for a person to read and send; nothing is emailed. Give email_subject and email_body (plain text, blank line between paragraphs, [[LINK]] where the review link goes) to write it yourself, or leave them out for the standard wording. A draft already on the task is left alone.",
      {
        task_id: z.string(), kind: KIND,
        draft_email: z.boolean().optional().describe("false to skip drafting the email"),
        email_subject: z.string().optional(), email_body: z.string().optional(),
      },
      async ({ task_id, kind, draft_email, email_subject, email_body }) => reply(await services.sendForReview(task_id, kind, {
        draftEmail: draft_email !== false, subject: email_subject, bodyHtml: email_body ? draftPlainTextToHtml(email_body) : undefined,
      })));

    server.tool("get_review_link",
      "The client's private link to a review, when it is on. Treat it as a secret: send it only to that task's client.",
      { task_id: z.string(), kind: KIND },
      async ({ task_id, kind }) => reply(await services.getReviewLink(task_id, kind)));

    server.tool("revoke_review_link",
      "Turn a review's link off for good. The client can't open it any more; the next send makes a new link.",
      { task_id: z.string(), kind: KIND },
      async ({ task_id, kind }) => reply(await services.revokeReviewLink(task_id, kind)));

    server.tool("add_review_comment",
      "Post a comment on a review as Claude, in the thread the client sees (for example, to answer a client's comment). It never emails the client. On an image or HTML review, pin puts a numbered pin on a version at x and y (0 to 1 across and down). On the client document, quote ties it to words in the text.",
      {
        task_id: z.string(), kind: KIND, text: z.string().min(1),
        quote: z.string().optional(),
        pin: z.object({
          version: VERSION, x: z.number().min(0).max(1), y: z.number().min(0).max(1),
          image: z.union([z.number().int().min(1).max(10), z.string()]).optional().describe("on an image review version with several images, which one: its position (1 based) or label; the first when left out"),
        }).optional(),
      },
      async ({ task_id, kind, text, quote, pin }) => reply(await services.addComment(task_id, kind, text, { quote, pin })));

    server.tool("update_review_comment",
      "Mark a review comment done (or open again), or change the words of a comment Claude wrote. Comment ids come from get_review.",
      { comment_id: z.string(), text: z.string().optional(), done: z.boolean().optional() },
      async ({ comment_id, text, done }) => reply(await services.updateComment(comment_id, { text, done })));

    server.tool("delete_review_comment",
      "Delete a comment from a review's thread. Comment ids come from get_review.",
      { comment_id: z.string() },
      async ({ comment_id }) => reply(await services.deleteComment(comment_id)));

    server.tool("delete_review",
      "Delete a review from a task. Its link stops working; restore_review brings it back, with everything, within 30 days.",
      { task_id: z.string(), kind: KIND },
      async ({ task_id, kind }) => reply(await services.deleteReview(task_id, kind)));

    server.tool("restore_review",
      "Bring back the review of this kind deleted most recently (within 30 days). The task can't have a live one of that kind.",
      { task_id: z.string(), kind: KIND },
      async ({ task_id, kind }) => reply(await services.restoreReview(task_id, kind)));
  }

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

  server.tool("get_client_link",
    "The client's own portal link (/waiting/<token>) — the page where they see what we're waiting on them for, reply, upload files, and mark things done. Use this when you're drafting an email or SMS to a client and need to give them somewhere to respond. Pass project_id to link to just that one list instead of the whole account. Mints the link on first use if the client hasn't got one yet.\n\nTreat it as a secret: anyone holding the URL can see that client's tasks without signing in, so it goes to that client and nobody else. Never put one client's link in another client's message, and never post it anywhere public.",
    { client_id: z.string(), project_id: z.string().optional().describe("link to a single list rather than the whole client") },
    async ({ client_id, project_id }) => {
      if (client_id === PERSONAL_CLIENT_ID) return { content: [{ type: "text", text: "Personal tasks are private — there is no client link for them." }] };
      const [client] = await sb(`clients?select=name,share_token&id=eq.${enc(client_id)}`);
      if (!client) return { content: [{ type: "text", text: `No client ${client_id}.` }] };

      // A project link is its own token, not the client's with a query
      // parameter — same split the web app makes, so revoking one doesn't
      // touch the other.
      if (project_id) {
        const [project] = await sb(`projects?select=name,client_id,share_token&id=eq.${enc(project_id)}`);
        if (!project) return { content: [{ type: "text", text: `No list ${project_id}.` }] };
        if (project.client_id !== client_id) return { content: [{ type: "text", text: `List ${project_id} doesn't belong to ${client.name}.` }] };
        let token = project.share_token;
        if (!token) {
          token = mintShareToken();
          await sb(`projects?id=eq.${enc(project_id)}`, "PATCH", { share_token: token });
        }
        return { content: [{ type: "text", text: `${APP_URL}/waiting/${token}\n\nGoes straight to ${client.name}'s "${project.name}" list. Send only to that client.` }] };
      }

      let token = client.share_token;
      if (!token) {
        token = mintShareToken();
        await sb(`clients?id=eq.${enc(client_id)}`, "PATCH", { share_token: token });
      }
      return { content: [{ type: "text", text: `${APP_URL}/waiting/${token}\n\n${client.name}'s portal. Send only to that client.` }] };
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

  return server;
}
