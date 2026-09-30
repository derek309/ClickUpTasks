
import { todayIso, DEFAULT_DUE, DEFAULT_FOLLOW_UP } from "./lib/dates.js";

const API_BASE = "https://clickuptasks.vercel.app";
// Matches the /api/extension/upload route's own limit.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const formEl = document.getElementById("form");
const needsTokenEl = document.getElementById("needsToken");
const clientSearchInput = document.getElementById("clientSearch");
const clientResultsEl = document.getElementById("clientResults");
const matchHintEl = document.getElementById("matchHint");
const addContactEl = document.getElementById("addContact");
const subAccountSel = document.getElementById("subAccountSel");
const addContactBtn = document.getElementById("addContactBtn");
const addContactNameEl = document.getElementById("addContactName");
const screenshotGalleryEl = document.getElementById("screenshotGallery");
const pickViewEl = document.getElementById("pickView");
const newViewEl = document.getElementById("newView");
const newTaskBtn = document.getElementById("newTaskBtn");
const backToTasksBtn = document.getElementById("backToTasks");
const taskFilterInput = document.getElementById("taskFilter");
const taskListEl = document.getElementById("taskList");
const taskEmptyEl = document.getElementById("taskEmpty");
const listHeadingEl = document.getElementById("listHeading");
const sourceIconEl = document.getElementById("sourceIcon");
const sourceTitleEl = document.getElementById("sourceTitle");
const sourceSubEl = document.getElementById("sourceSub");
const projectSel = document.getElementById("project");
const dueInput = document.getElementById("due");
const followUpInput = document.getElementById("followUp");
const prioritySel = document.getElementById("priority");
const assigneeSel = document.getElementById("assignee");
const titleInput = document.getElementById("title");
const notesInput = document.getElementById("notes");
const statusEl = document.getElementById("status");
const createBtn = document.getElementById("create");
const enrichBtn = document.getElementById("enrich");
const emailAttsEl = document.getElementById("emailAtts");
const emailAttsListEl = document.getElementById("emailAttsList");
const refreshBtn = document.getElementById("refresh");

let permalink = null;
let senderName = null;
let senderEmail = null;
// The Gmail API ids scraped alongside the rest of the email, held so the task
// can be bound to its thread once it exists.
let mailIds = { gmailMessageId: null, rfc822MessageId: null };
let allClients = []; // [{id, name, company, contactName}]
let selectedClientId = "";
// The picker ROW that was chosen, which is not always the client: a workspace
// project is its own row (p_...) filed under the workspace client. Keeping
// both is what lets a remembered project actually re-select. See the comment
// on rememberClientForSender.
let selectedEntryId = "";
// "user" once a person picked the client themselves, "server" when it was
// auto-matched. Only a "user" pick is ever taught to the memory.
let clientSource = null;
let capturedScreenshots = []; // data URLs, in the order added
let allTasks = []; // [{id, title, status, projectId, due, followUpAt, waitingOnClient}] for the current client
// Tasks this email or page is already on (by its link), pinned to the top.
let clippedTasks = [];
// The row that is open, showing its note box and Add button.
let openTaskId = "";
// List id -> name, to label each task row with where it lives.
let projectNames = {};

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function getToken() {
  const { apiToken } = await chrome.storage.local.get("apiToken");
  return apiToken || null;
}

async function apiFetch(path, token, init) {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

// Screenshots are captured as data URLs (chrome.tabs.captureVisibleTab) but
// the upload route wants multipart/form-data, so this converts + posts
// separately from apiFetch, which always sends JSON.
// Bind the clipped email's thread to the task, so every future reply lands
// there rather than on a generic "Reply to <client>" task. Best effort on
// purpose: the task and its notes are already saved by the time this runs,
// and failing to resolve a thread is not a reason to say the clip failed.
async function attachEmailThread(token, taskId) {
  if (!taskId) return;
  if (!mailIds.gmailMessageId && !mailIds.rfc822MessageId && !titleInput.value.trim()) return;
  try {
    const res = await apiFetch("/api/extension/attach-email", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        gmail_message_id: mailIds.gmailMessageId,
        rfc822_message_id: mailIds.rfc822MessageId,
        from_email: senderEmail,
        subject: titleInput.value.trim(),
      }),
    });
    if (res?.ok) {
      // Says which, because matching on a subject line is a guess and should
      // not be reported in the same voice as reading the thread's own id.
      // Says what landed and what was already here, separately: "3 imported"
      // for an import that wrote nothing is how a broken index went unnoticed.
      const had = res.alreadyHad ? `, ${res.alreadyHad} already here` : "";
      const count = `${res.imported} message${res.imported === 1 ? "" : "s"} imported${had}`;
      // A disagreement between what we tried to write and what the database
      // confirmed is the whole bug we have been chasing, so say it out loud
      // rather than rounding it up into a success.
      // A line under the "Task created / Added" link, not in place of it.
      const line = document.createElement("div");
      if (typeof res.attempted === "number" && res.attempted !== res.imported) {
        line.textContent = `Thread bound, but ${res.attempted - res.imported} message(s) did not save. Thread ${res.threadId}.`;
        line.className = "err";
      } else {
        line.textContent = res.confident
          ? `Watching this thread: ${count}.`
          : `Matched by subject: ${count}. Check it is the right thread.`;
        line.className = res.confident ? "muted" : "err";
      }
      statusEl.append(line);
    }
  } catch {
    // Silent: the clip itself worked.
  }
}

async function uploadScreenshot(token, dataUrl, clientId) {
  const blob = await (await fetch(dataUrl)).blob();
  const form = new FormData();
  form.set("client_id", clientId);
  form.set("file", new File([blob], "screenshot.png", { type: "image/png" }));
  const res = await fetch(`${API_BASE}/api/extension/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Screenshot upload failed");
  return json.path;
}

async function getCurrentEmail() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "CLICKUPTASKS_GET_EMAIL" });
  } catch {
    // No content script on this tab (not Gmail, or the page hasn't finished
    // loading) — fail soft, the form still opens blank/manually-fillable.
    return null;
  }
}

async function getPendingCapture() {
  const { pendingCapture } = await chrome.storage.local.get("pendingCapture");
  await chrome.storage.local.remove("pendingCapture");
  return pendingCapture || null;
}

// Reads the current tab's title/url directly (needs the "tabs" permission —
// added specifically so this doesn't depend on activeTab having been granted
// via a toolbar click first). Unlike the screenshot pixels below, there's no
// Chrome gesture requirement for reading these two fields.
async function readActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function renderScreenshotGallery() {
  screenshotGalleryEl.innerHTML = "";
  capturedScreenshots.forEach((dataUrl, i) => {
    const thumb = document.createElement("div");
    thumb.className = "shot-thumb";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = `Screenshot ${i + 1}`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "shot-remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      capturedScreenshots.splice(i, 1);
      renderScreenshotGallery();
    });
    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    screenshotGalleryEl.appendChild(thumb);
  });
  // The paste zone stays visible even with screenshots already added — you
  // can keep pasting more, one at a time.
}

function addScreenshot(dataUrl) {
  capturedScreenshots.push(dataUrl);
  renderScreenshotGallery();
}

function clearScreenshots() {
  capturedScreenshots = [];
  renderScreenshotGallery();
}

// Manual fallback for the one thing that genuinely needs a toolbar-icon
// click: capturing pixels. Pasting a system screenshot (e.g. macOS's
// Cmd+Ctrl+Shift+4, which copies straight to the clipboard, or a full-page
// capture from GoFullPage) doesn't need any special Chrome permission — a
// plain paste event works anywhere in the panel, not just when the paste
// zone itself has focus, since an image can't usefully land in a text field
// anyway. Each paste adds another screenshot rather than replacing the last.
document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (!item) return;
  const blob = item.getAsFile();
  if (!blob) return;
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = () => addScreenshot(reader.result);
  reader.readAsDataURL(blob);
});

async function loadClients(token, force = false) {
  // Cache for a few minutes so reopening the panel repeatedly doesn't
  // re-fetch every time. force=true (the Refresh button) always skips this
  // and re-fetches — otherwise a client added moments ago (e.g. from a
  // territory sync) stays invisible for up to 5 minutes even after Refresh,
  // since the button would just re-search the same stale cached list.
  if (!force) {
    const cached = await chrome.storage.local.get(["clientsCache", "clientsCacheAt"]);
    const fresh = cached.clientsCacheAt && Date.now() - cached.clientsCacheAt < 5 * 60 * 1000;
    if (fresh && cached.clientsCache) return cached.clientsCache;
  }
  const { clients } = await apiFetch("/api/extension/clients", token);
  await chrome.storage.local.set({ clientsCache: clients, clientsCacheAt: Date.now() });
  return clients;
}

async function loadSubAccounts(token) {
  // Same 5-minute cache idiom as loadClients/loadMembers — admin-only, 403s
  // silently for a VA token (caught by the caller).
  const cached = await chrome.storage.local.get(["subAccountsCache", "subAccountsCacheAt"]);
  const fresh = cached.subAccountsCacheAt && Date.now() - cached.subAccountsCacheAt < 5 * 60 * 1000;
  if (fresh && cached.subAccountsCache) return cached.subAccountsCache;
  const { subAccounts } = await apiFetch("/api/extension/subaccounts", token);
  await chrome.storage.local.set({ subAccountsCache: subAccounts, subAccountsCacheAt: Date.now() });
  return subAccounts;
}

async function loadMembers(token) {
  // Same 5-minute cache idiom as loadClients — the roster changes rarely.
  const cached = await chrome.storage.local.get(["membersCache", "membersCacheAt"]);
  const fresh = cached.membersCacheAt && Date.now() - cached.membersCacheAt < 5 * 60 * 1000;
  const members = fresh && cached.membersCache ? cached.membersCache : (await apiFetch("/api/extension/members", token)).members;
  if (!fresh) await chrome.storage.local.set({ membersCache: members, membersCacheAt: Date.now() });

  assigneeSel.innerHTML = "";
  const meOpt = document.createElement("option");
  meOpt.value = "";
  meOpt.textContent = "Me";
  assigneeSel.appendChild(meOpt);
  for (const m of members) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.name} ${m.role === "va" ? "(VA)" : "(Admin)"}`;
    assigneeSel.appendChild(opt);
  }
}

async function loadProjectsFor(clientId) {
  projectSel.innerHTML = "";
  projectNames = {};
  const blankOpt = document.createElement("option");
  blankOpt.value = "";
  blankOpt.textContent = "Default";
  projectSel.appendChild(blankOpt);
  if (!clientId) return;
  const token = await getToken();
  if (!token) return;
  try {
    const { projects } = await apiFetch(`/api/extension/projects?client_id=${encodeURIComponent(clientId)}`, token);
    for (const p of projects) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      projectSel.appendChild(opt);
      projectNames[p.id] = p.name;
    }
    renderTaskList();
  } catch { /* leave just "Default" — task creation still works via the fallback */ }
}

async function loadTasksFor(clientId) {
  allTasks = [];
  openTaskId = "";
  taskFilterInput.value = "";
  renderTaskList(clientId ? "Loading their open tasks…" : null);
  if (!clientId) return;
  const token = await getToken();
  if (!token) return;
  try {
    const { tasks } = await apiFetch(`/api/extension/tasks?client_id=${encodeURIComponent(clientId)}`, token);
    // A reply from another client can land while this one loads; keep only
    // the answer for the client still selected.
    if (clientId !== selectedClientId) return;
    allTasks = tasks;
  } catch { /* leave empty — the list says there are none */ }
  renderTaskList();
}

function clientLabel(c) {
  if (c.kind === "project") return c.name;
  return c.company ? `${c.name} — ${c.company}` : c.name;
}

function renderClientResults(query) {
  const q = query.trim().toLowerCase();
  const matches = !q ? allClients : allClients.filter((c) =>
    c.name.toLowerCase().includes(q) || (c.company || "").toLowerCase().includes(q) || (c.contactName || "").toLowerCase().includes(q)
  );
  clientResultsEl.innerHTML = "";
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "result-row";
    empty.style.cssText = "color:#94a3b8;cursor:default;";
    empty.textContent = "No matches";
    clientResultsEl.appendChild(empty);
  } else {
    for (const c of matches.slice(0, 50)) {
      const row = document.createElement("div");
      row.className = "result-row";
      const nameEl = document.createElement("div");
      nameEl.className = "result-name";
      nameEl.textContent = c.name;
      const subBits = c.kind === "project" ? ["Internal project"] : [c.company, c.contactName ? `Contact: ${c.contactName}` : null].filter(Boolean);
      row.appendChild(nameEl);
      if (subBits.length) {
        const subEl = document.createElement("div");
        subEl.className = "result-sub";
        subEl.textContent = subBits.join(" · ");
        row.appendChild(subEl);
      }
      // mousedown, not click — fires before the input's blur event, so the
      // selection registers before the dropdown gets hidden by the blur handler.
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectClient(c.id);
        clientSource = "user";
        void rememberClientForSender(senderEmail, c);
        if (siteMode) void rememberClientForSite(c);
      });
      clientResultsEl.appendChild(row);
    }
  }
  clientResultsEl.classList.add("open");
}

// The sender's email didn't match any existing client — offer to create a
// real GHL contact for them right here instead of leaving a dead end. Only
// meaningful when there's a sender to name (Gmail path); silently a no-op
// if the caller's token isn't an admin (POST .../contacts 403s with a clear
// message rather than this ever guessing at permissions client-side).
async function showAddContact() {
  addContactNameEl.textContent = senderName || senderEmail;
  addContactEl.style.display = "";
  subAccountSel.innerHTML = "<option value=''>Loading sub-accounts…</option>";
  const token = await getToken();
  if (!token) return;
  try {
    const subAccounts = await loadSubAccounts(token);
    subAccountSel.innerHTML = "";
    if (!subAccounts.length) {
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "No sub-accounts available";
      subAccountSel.appendChild(opt);
      return;
    }
    for (const s of subAccounts) {
      const opt = document.createElement("option");
      opt.value = s.id; opt.textContent = s.name;
      subAccountSel.appendChild(opt);
    }
  } catch {
    subAccountSel.innerHTML = "<option value=''>Couldn't load sub-accounts</option>";
  }
}

addContactBtn.addEventListener("click", async () => {
  if (!subAccountSel.value) return;
  const token = await getToken();
  if (!token) return;
  // Just disable (existing button:disabled CSS dims it) — never touch
  // innerHTML here, or the nested #addContactName span gets replaced and
  // the cached DOM reference above goes stale on the next showAddContact().
  addContactBtn.disabled = true;
  try {
    const data = await apiFetch("/api/extension/contacts", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subAccountId: subAccountSel.value, name: senderName || senderEmail, email: senderEmail }),
    });
    // Force-refresh so the newly created client is actually in allClients —
    // this is exactly the cache the Refresh-button fix above addresses.
    allClients = await loadClients(token, true);
    selectClient(data.clientId);
    statusEl.textContent = `Added ${data.name} as a contact.`;
    statusEl.className = "ok";
  } catch (e) {
    statusEl.textContent = String(e?.message ?? e);
    statusEl.className = "err";
  } finally {
    addContactBtn.disabled = false;
  }
});

// Tomorrow, yyyy-mm-dd, in the user's own timezone — toISOString() would
// hand back UTC and land on the wrong day for anyone west of Greenwich after
// late afternoon, which is every one of us (Derek, 2026-08-26: "auto adding
// the due date for tomorrow").
// Learned sender -> client memory (Derek, 2026-08-26: "as I use it in Gmail
// can it start to remember the client and auto select it?"). The server-side
// match-client lookup only knows contacts and company domains; this records
// what you actually picked, so a correction sticks for that sender next time.
//
// This used to live in chrome.storage.local. It now lives on the server
// (supabase/sender-client-memory.sql), so it survives a reinstall, reaches
// every machine you sign in from, and a mapping a teammate taught can help
// you. The old local map is deliberately NOT migrated: about half of it holds
// malformed values from the bug described below, and there is no way to tell
// those from the good ones.
//
// Two bugs are fixed in the move:
//  1. It stored the picker ROW's id from one code path and the resolved
//     CLIENT's id from another. Recall looks rows up by row id, so anything
//     the Create path wrote for a workspace project could never be recalled.
//     Hence selectedEntryId below, tracked separately from selectedClientId.
//  2. It saved the server's own automatic guesses, so one wrong domain match
//     became permanent. Hence clientSource: only an explicit pick is taught.
async function rememberClientForSender(email, entry) {
  if (!email || !entry) return;
  const token = await getToken();
  if (!token) return;
  try {
    await apiFetch("/api/extension/match-client", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        // A workspace project files under the workspace pseudo-client, and the
        // project itself is the row to re-select next time.
        client_id: entry.kind === "project" ? entry.clientId : entry.id,
        entry_id: entry.kind === "project" ? entry.id : null,
      }),
    });
  } catch { /* the clip matters, the memory does not — never block on this */ }
}

function selectClient(id) {
  const c = allClients.find((x) => x.id === id);
  if (!c) return;
  selectedEntryId = c.id;
  clientSearchInput.value = clientLabel(c);
  clientResultsEl.classList.remove("open");
  addContactEl.style.display = "none";
  if (c.kind === "project") {
    // A workspace project (Administration, Idea board, …) — the task's
    // client is the workspace pseudo-client; pre-select this exact project
    // in the List dropdown once it's populated.
    selectedClientId = c.clientId;
    loadProjectsFor(selectedClientId).then(() => { projectSel.value = c.id; });
  } else {
    selectedClientId = c.id;
    loadProjectsFor(selectedClientId);
  }
  loadTasksFor(selectedClientId);
  if (siteMode) void resolveSiteTarget();
}

clientSearchInput.addEventListener("input", () => {
  selectedClientId = ""; // typing invalidates any prior selection/auto-match
  matchHintEl.textContent = "";
  allTasks = [];
  renderTaskList();
  showView(siteMode ? "none" : "pick");
  if (siteMode) { siteTarget = null; renderSiteTarget(); }
  renderClientResults(clientSearchInput.value);
});
clientSearchInput.addEventListener("focus", () => renderClientResults(clientSearchInput.value));
clientSearchInput.addEventListener("blur", () => clientResultsEl.classList.remove("open"));

// How soon a task needs you, from its follow up date, else its due date.
const localToday = () => todayIso();
function dateOf(t) { return t.followUpAt || t.due || null; }
function pillFor(t) {
  const d = dateOf(t);
  if (!d) return null;
  const today = localToday();
  const days = Math.round((Date.parse(`${d}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86400000);
  if (days < 0) return { text: `${-days}d late`, tone: "late" };
  if (days === 0) return { text: "Today", tone: "soon" };
  if (days === 1) return { text: "Tomorrow", tone: "soon" };
  return { text: new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }), tone: "later" };
}

// The client's open tasks as the first thing on the panel, so adding an email
// to work that already exists is one click, not a mode switch and a search
// (Derek, 2026-09-30). The task the email is already on sits at the top.
function renderTaskList(loadingText = null) {
  taskListEl.innerHTML = "";
  const first = clientSearchInput.value.split(/[ —]/)[0] || "the client";
  listHeadingEl.textContent = !selectedClientId ? "Pick a client" : siteMode ? "Put the changes on" : "Add to a task";
  newTaskBtn.disabled = !selectedClientId;
  taskFilterInput.style.display = selectedClientId && allTasks.length > 5 ? "" : "none";
  taskFilterInput.placeholder = `Search ${first}'s ${allTasks.length} open tasks`;
  if (loadingText || !selectedClientId) {
    taskEmptyEl.textContent = loadingText || "Choose who this is for above, then pick one of their tasks or make a new one.";
    return;
  }
  const q = taskFilterInput.value.trim().toLowerCase();
  const here = new Set(clippedTasks.map((t) => t.id));
  const pinned = clippedTasks.filter((t) => !t.clientId || t.clientId === selectedClientId);
  const rest = allTasks.filter((t) => !here.has(t.id)).sort((a, b) => {
    const da = dateOf(a), db = dateOf(b);
    if (da && db) return da.localeCompare(db);
    return da ? -1 : db ? 1 : 0;
  });
  const shown = [...pinned, ...rest].filter((t) => !q || t.title.toLowerCase().includes(q));
  taskEmptyEl.textContent = shown.length ? "" : q ? "No open task matches that." : `${first} has no open tasks. Make a new one.`;
  for (const t of shown.slice(0, 60)) taskListEl.append(taskRow(t, here.has(t.id)));
}

function taskRow(t, isHere) {
  const wrap = document.createElement("div");
  wrap.className = `task${isHere ? " here" : ""}${t.id === openTaskId ? " open" : ""}`;
  const row = document.createElement("div");
  row.className = "task-row";
  const text = document.createElement("div");
  text.className = "t";
  const title = document.createElement("b");
  title.textContent = t.title;
  const sub = document.createElement("span");
  if (siteMode && t.id === siteTarget?.taskId) { sub.className = "flag"; sub.textContent = "Changes go here now"; }
  else if (isHere) { sub.className = "flag"; sub.textContent = siteMode ? "Changes from this site" : "This is already on it"; }
  else sub.textContent = [projectNames[t.projectId], t.waitingOnClient ? "Waiting on the client" : null].filter(Boolean).join(" · ");
  text.append(title, sub);
  row.append(text);
  const pill = !isHere && pillFor(t);
  if (pill) {
    const p = document.createElement("span");
    p.className = `pill ${pill.tone}`;
    p.textContent = pill.text;
    row.append(p);
  }
  row.addEventListener("click", () => {
    // Reviewing a site, a row is where the changes go, not a note box.
    if (siteMode) { void setSiteTarget(t); return; }
    openTaskId = openTaskId === t.id ? "" : t.id; renderTaskList();
  });
  wrap.append(row);
  if (t.id === openTaskId) {
    // What goes on the task: a note (the email's sender and opening lines,
    // editable), plus the attachments and screenshots ticked above.
    const add = document.createElement("div");
    add.className = "task-add";
    const note = document.createElement("textarea");
    note.value = notesInput.value;
    note.placeholder = "Add a note (optional)";
    note.setAttribute("aria-label", `Note for ${t.title}`);
    const go = document.createElement("button");
    go.type = "button";
    go.textContent = permalink && senderEmail ? "Add email to this task" : "Add to this task";
    go.addEventListener("click", () => void submit({ taskId: t.id, taskTitle: t.title, body: note.value.trim(), button: go }));
    const open = document.createElement("a");
    open.className = "open-link";
    open.href = `${API_BASE}/?task=${encodeURIComponent(t.id)}`;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "Open the task";
    add.append(note, go, open);
    wrap.append(add);
    requestAnimationFrame(() => note.focus());
  }
  return wrap;
}
taskFilterInput.addEventListener("input", () => { openTaskId = ""; renderTaskList(); });

// The two views. New task is the form it always was, one click in.
function showView(which) {
  pickViewEl.style.display = which === "pick" ? "" : "none";
  newViewEl.style.display = which === "new" ? "" : "none";
  if (which === "new") titleInput.focus();
}
newTaskBtn.addEventListener("click", () => (siteMode ? void setSiteTarget(null) : showView("new")));
backToTasksBtn.addEventListener("click", () => showView("pick"));

// A side panel stays open as you browse (unlike a popup, which closes on
// any click outside it) — Refresh re-reads whatever's currently open
// instead of requiring a full reload. Title/URL are read live below (needs
// no special permission grant), so they're never dependent on a click. Only
// the screenshot pixels need either the toolbar-icon click (background.js
// captures via activeTab) or the in-panel paste zone above.
async function init(forceClientRefresh = false) {
  const token = await getToken();
  if (!token) {
    formEl.style.display = "none";
    needsTokenEl.style.display = "block";
    return;
  }
  formEl.style.display = "";
  leaveSiteMode();
  // enrichedKey is deliberately NOT reset here: init() re-runs on Refresh and
  // on every new screenshot, and clearing it would re-run the AI on an email
  // it has already read.
  selectedEntryId = "";
  clientSource = null;
  needsTokenEl.style.display = "none";
  statusEl.textContent = "";
  statusEl.className = "";
  matchHintEl.textContent = "";
  matchHintEl.className = "";
  addContactEl.style.display = "none";
  selectedClientId = "";
  allTasks = [];
  renderTaskList();
  clientSearchInput.value = "";
  emailAttachments = [];
  renderEmailAttachments();
  clippedTasks = [];
  dueInput.value = DEFAULT_DUE();
  followUpInput.value = DEFAULT_FOLLOW_UP();
  prioritySel.value = "normal";
  assigneeSel.value = "";
  clearScreenshots();
  showView("pick");

  const [email, capture, tab, clients] = await Promise.all([
    getCurrentEmail(), getPendingCapture(), readActiveTab(), loadClients(token, forceClientRefresh).catch(() => []), loadMembers(token).catch(() => {}),
  ]);
  allClients = clients;
  clientSearchInput.placeholder = clients.length ? "Search by name, business, or contact…" : "No clients available";
  await loadProjectsFor("");
  await loadTasksFor("");

  // The screenshot is the one field that still depends on the toolbar-icon
  // click (or a manual paste) — everything else below is read live, every
  // time the panel opens or Refresh is pressed.
  if (capture?.screenshot) addScreenshot(capture.screenshot);

  // Any website that is not Gmail: the site review list, not the email form.
  if (!email && siteOf(tab)) {
    await enterSiteMode(tab, token);
    return;
  }

  if (email) {
    // Gmail — same as before, takes priority over the generic tab data.
    titleInput.value = email.subject || "";
    senderName = email.senderName || null;
    senderEmail = email.senderEmail || null;
    const fromLine = senderName || senderEmail ? `From: ${senderName || ""}${senderEmail ? ` <${senderEmail}>` : ""}` : "";
    notesInput.value = [fromLine, email.snippet || ""].filter(Boolean).join("\n\n");
    sourceIconEl.textContent = "✉️";
    sourceTitleEl.textContent = email.subject || "(no subject)";
    sourceSubEl.textContent = senderName || senderEmail || "";
    permalink = email.permalink || null;
    mailIds = { gmailMessageId: email.gmailMessageId || null, rfc822MessageId: email.rfc822MessageId || null };
    // Ticked by default: if you're clipping an email that has attachments,
    // wanting them on the task is the common case (Derek: "add all the
    // attachments so we can see them"). Untick to leave one behind.
    emailAttachments = (email.attachments || []).map((a) => ({ ...a, keep: true }));
    renderEmailAttachments(true);
    void showAlreadyClipped(permalink);
  } else {
    // Any other page — title/URL are native tab properties (needs the
    // "tabs" permission), no scraping or click needed for these two fields.
    titleInput.value = tab?.title || "";
    sourceIconEl.textContent = "🌐";
    sourceTitleEl.textContent = tab?.title || "This page";
    sourceSubEl.textContent = tab?.url ? new URL(tab.url).hostname : "";
    senderName = null;
    senderEmail = null;
    emailAttachments = [];
    renderEmailAttachments();
    notesInput.value = "";
    permalink = tab?.url || null;
    void showAlreadyClipped(permalink);
  }

  // The remembered tier is the server's now, and it is checked first there —
  // what you picked yourself for this exact sender outranks a contact or a
  // domain guess. See /api/extension/match-client.
  const MATCH_HINT = {
    remembered: "✓ Remembered for this sender",
    exact: "✓ Matched from the sender's email",
    domain: "Guessed from the company domain, check it",
  };
  if (senderEmail) {
    try {
      const { match } = await apiFetch(`/api/extension/match-client?email=${encodeURIComponent(senderEmail)}`, token);
      if (match) {
        // entryId first: a remembered workspace project IS its own picker row,
        // and the client it files under is never in the list to select.
        selectClient(match.entryId || match.clientId);
        clientSource = "server";
        matchHintEl.textContent = `${MATCH_HINT[match.matchType] || MATCH_HINT.exact} (${senderEmail})`;
        matchHintEl.className = match.matchType === "domain" ? "guess" : "";
      } else {
        showAddContact();
      }
    } catch { /* match lookup failed — leave the picker empty, no add-contact offer either */ }
  } else if (!email && permalink) {
    // Only for the generic-page capture path — a Gmail email with no
    // detected sender shouldn't fall back to matching mail.google.com's
    // own domain against a client.
    try {
      const domain = new URL(permalink).hostname;
      const { match } = await apiFetch(`/api/extension/match-client?domain=${encodeURIComponent(domain)}`, token);
      if (match) {
        selectClient(match.entryId || match.clientId);
        clientSource = "server";
        matchHintEl.textContent = "Guessed from this page's domain, check it";
        matchHintEl.className = "guess";
      }
    } catch { /* not a valid URL, or no match — leave the picker empty */ }
  }

  if (!email && !tab?.title && !permalink) {
    // Rare: this tab can't be read at all (a chrome:// page) and there's no
    // Gmail email either — the form still opens, fully fillable by hand.
    statusEl.textContent = "Couldn't read this page — fill in the form manually below.";
    statusEl.className = "";
  }

  // Last thing init() does: the title, the notes and the message ids are all
  // populated by now, which is everything the AI call and its once-per-email
  // key need.
  maybeAutoEnrich();
}

refreshBtn.addEventListener("click", () => init(true));

// Which capture has already been enriched, so the AI runs once per email
// rather than once per render. A boolean was not enough: init() re-runs on
// load, on Refresh, and whenever a new screenshot lands in storage, so a flag
// reset at the top of init() re-fires the AI on the SAME email every time.
// Keyed on the Gmail message id, which is stable across all three.
let enrichedKey = null;

function captureKey() {
  return mailIds.gmailMessageId || mailIds.rfc822MessageId || permalink || null;
}

// Runs on its own when the panel opens on an email (Derek, 2026-09-04). This
// deliberately reverses the old rule of "never automatically, so opening the
// panel never spends money": the panel is now expected to be filled in by the
// time you look at it. The cost shape is one call per email opened, which the
// key above holds to once per email no matter how often init() re-runs. The
// button below still forces a re-run, and runEnrich never overwrites a field
// you have typed in.
function maybeAutoEnrich() {
  const key = captureKey();
  if (!key || key === enrichedKey || enrichBtn.disabled) return;
  // Nothing scraped yet — let Refresh try again rather than burning a call on
  // an empty body.
  if (!titleInput.value.trim() && !notesInput.value.trim()) return;
  enrichedKey = key;
  runEnrich();
}

async function runEnrich() {
  const token = await getToken();
  if (!token) return;
  enrichBtn.disabled = true;
  enrichBtn.textContent = "Enriching…";
  // Snapshot first. This call can take seconds and now starts without being
  // asked, so anything you type while it is in flight has to survive it.
  const before = {
    title: titleInput.value, notes: notesInput.value,
    due: dueInput.value, followUp: followUpInput.value, priority: prioritySel.value,
  };
  try {
    const r = await apiFetch("/api/extension/enrich", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // today is the panel's LOCAL date: the server clamps against it, and its
      // own UTC fallback is a day ahead for a whole evening in Pacific time.
      body: JSON.stringify({ subject: titleInput.value, senderName, senderEmail, body: notesInput.value, today: todayIso() }),
    });
    // Only fields you have not touched since the call went out. The `&& value`
    // guards also mean an older server that still returns just a title and a
    // description leaves the three new fields on their defaults.
    if (titleInput.value === before.title && r.title) titleInput.value = r.title;
    if (notesInput.value === before.notes && r.description) notesInput.value = r.description;
    if (dueInput.value === before.due && r.due) dueInput.value = r.due;
    if (followUpInput.value === before.followUp && r.followUpAt) followUpInput.value = r.followUpAt;
    if (prioritySel.value === before.priority && r.priority) prioritySel.value = r.priority;
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : "AI enrichment failed.";
    statusEl.className = "err";
  } finally {
    enrichBtn.disabled = false;
    enrichBtn.textContent = "✨ Fill in with AI";
  }
}

// The button forces a re-run, including on an email already enriched.
enrichBtn.addEventListener("click", () => { enrichedKey = captureKey(); runEnrich(); });

function resetFormAfterSubmit() {
  // Cleared here, unlike in init(): the task was created and whatever gets
  // clipped next is a different capture.
  enrichedKey = null;
  selectedEntryId = "";
  clientSource = null;
  titleInput.value = "";
  notesInput.value = "";
  selectedClientId = "";
  clientSearchInput.value = "";
  emailAttachments = [];
  renderEmailAttachments();
  clippedTasks = [];
  projectSel.value = "";
  dueInput.value = DEFAULT_DUE();
  followUpInput.value = DEFAULT_FOLLOW_UP();
  prioritySel.value = "normal";
  assigneeSel.value = "";
  matchHintEl.textContent = "";
  clearScreenshots();
  openTaskId = "";
  taskFilterInput.value = "";
  allTasks = [];
  renderTaskList();
  showView("pick");
}

createBtn.addEventListener("click", () => void submit({ button: createBtn }));

// One path for both: a new task from the form, or this added to an existing
// task picked from the list (`taskId`, with the note from its own box).
async function submit({ taskId = null, taskTitle = "", body = "", button }) {
  const token = await getToken();
  if (!token) return;
  const clientId = selectedClientId;
  const isNew = !taskId;
  if (!clientId) {
    statusEl.textContent = "Pick a client.";
    statusEl.className = "err";
    return;
  }
  if (isNew && !titleInput.value.trim()) {
    statusEl.textContent = "Enter a title.";
    statusEl.className = "err";
    return;
  }

  button.disabled = true;
  statusEl.textContent = isNew ? "Creating…" : "Adding…";
  statusEl.className = "";
  // Learn the client from what you actually filed against, not only from
  // adding a brand new contact (Derek: "when I pick a client and create a
  // task have it remember that client and preselect when I open another email
  // from them"). Picking a client and filing to it is the strongest signal
  // there is about who a sender belongs to — stronger than the server's
  // contact or domain guess, which is why the recall above beats it.
  //
  // Before the request rather than after: the point is the association, and
  // it should survive a task that fails to save for some unrelated reason.
  // Only when YOU picked it. Writing back an auto-match here is how one wrong
  // domain guess used to become permanent.
  if (clientSource === "user") void rememberClientForSender(senderEmail, allClients.find((c) => c.id === selectedEntryId));
  try {
    const screenshotPaths = [];
    for (const dataUrl of capturedScreenshots) screenshotPaths.push(await uploadScreenshot(token, dataUrl, clientId));
    const attCount = emailAttachments.filter((a) => a.keep).length;
    if (attCount) { statusEl.textContent = `Fetching ${attCount} attachment${attCount === 1 ? "" : "s"}…`; }
    const { files, skipped } = await uploadEmailAttachments(token, clientId);

    if (isNew) {
      const created = await apiFetch("/api/extension/tasks", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId, project_id: projectSel.value || undefined, title: titleInput.value.trim(), description: notesInput.value.trim(), link: permalink,
          due: dueInput.value || undefined, follow_up_at: followUpInput.value || undefined, priority: prioritySel.value, assignee_id: assigneeSel.value || undefined, screenshot_paths: screenshotPaths, files,
        }),
      });
      // Link straight to what was just made (Derek: "make a link to it so I
      // can click and go to it"); the thread line goes under it.
      showCreatedLink(created?.id, created?.title || titleInput.value.trim(), skipped, "Task created.");
      await attachEmailThread(token, created?.id);
    } else {
      // Nothing to say and nothing to attach is still a real clip: the email
      // thread itself is what gets bound to the task below.
      if (body || screenshotPaths.length || files.length) {
        await apiFetch(`/api/extension/tasks/${encodeURIComponent(taskId)}/comment`, token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, screenshot_paths: screenshotPaths, files }),
        });
      }
      showCreatedLink(taskId, taskTitle, skipped, "Added.");
      await attachEmailThread(token, taskId);
    }
    // The panel stays open (it's a sidebar, not a popup) — clear the form
    // instead of trying to close anything, ready for the next page.
    resetFormAfterSubmit();
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : "Failed.";
    statusEl.className = "err";
  } finally {
    button.disabled = false;
  }
}

// The side panel is persistent — clicking the toolbar icon while it's
// already open calls chrome.sidePanel.open() on the SAME document instead of
// reloading it, so init()'s one-time read of pendingCapture never sees a
// second capture. background.js still writes the new capture to storage on
// every click, so watch for that write directly and re-run init() to pick
// it up, covering both "panel was already open" and (harmlessly, since
// init() already consumed it before this listener could see the same write)
// the fresh-open case.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.pendingCapture?.newValue) return;
  // Reviewing this same site: a toolbar capture is one more screenshot for the
  // change being typed, not a reason to start the panel over.
  const cap = changes.pendingCapture.newValue;
  if (siteMode && siteOf({ url: cap.url })?.host === site?.host) {
    void chrome.storage.local.remove("pendingCapture");
    if (cap.screenshot) addScreenshot(cap.screenshot);
    return;
  }
  init();
});

init();


// ---------------------------------------------------------------------------

// Attachments found on the open Gmail message: [{ name, mime, url, keep }].
// Downloaded only on submit, and only the ticked ones.
let emailAttachments = [];









/** "Task created" plus a link to the thing itself. Built as real DOM rather
 *  than innerHTML so a task title containing < or & can't inject markup into
 *  the panel. Falls back to plain text if the API didn't hand back an id. */
function showCreatedLink(taskId, title, skipped = [], lead = "Task created.") {
  statusEl.textContent = "";
  statusEl.className = "ok";
  if (!taskId) { statusEl.textContent = lead; return; }
  statusEl.append(`${lead} `);
  const a = document.createElement("a");
  a.href = `${API_BASE}/?task=${encodeURIComponent(taskId)}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = title ? `Open “${title.length > 40 ? title.slice(0, 40).trimEnd() + "…" : title}”` : "Open it";
  a.className = "created-link";
  statusEl.append(a);
  // Named, not counted: "1 attachment skipped" leaves you wondering which.
  if (skipped.length) {
    const warn = document.createElement("div");
    warn.style.cssText = "margin-top:4px;color:#b45309;font-size:11px";
    warn.textContent = `Couldn't attach: ${skipped.join("; ")}`;
    statusEl.append(warn);
  }
}

const prettySize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function renderEmailAttachments(onGmail = false) {
  emailAttsListEl.innerHTML = "";
  if (!emailAttachments.length) {
    // On a Gmail message, say so out loud rather than hiding the block. A
    // silently-absent list is indistinguishable from a broken scrape, which
    // is exactly the confusion that cost Derek a round of testing.
    emailAttsEl.style.display = onGmail ? "" : "none";
    if (onGmail) {
      const none = document.createElement("div");
      none.className = "att-row";
      none.textContent = "No attachments found on this email.";
      emailAttsListEl.append(none);
    }
    return;
  }
  emailAttsEl.style.display = "";
  emailAttachments.forEach((a, i) => {
    const row = document.createElement("label");
    row.className = "att-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = a.keep;
    cb.addEventListener("change", () => { emailAttachments[i].keep = cb.checked; });
    const n = document.createElement("span");
    n.className = "n";
    n.textContent = a.name;
    n.title = a.name;
    row.append(cb, n);
    emailAttsListEl.append(row);
  });
}

/** Pull the ticked attachments through the content script (the only place
 *  Gmail's cookies apply) and upload each one. Failures are reported and
 *  skipped rather than aborting the whole task creation — losing the task
 *  because one file wouldn't download would be the worse outcome. */
async function uploadEmailAttachments(token, clientId) {
  const wanted = emailAttachments.filter((a) => a.keep);
  if (!wanted.length) return { files: [], skipped: [] };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const files = [];
  const skipped = [];
  for (const a of wanted) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "CLICKUPTASKS_FETCH_ATTACHMENT", url: a.url });
      if (!res || res.error || !res.dataUrl) { skipped.push(`${a.name} (${res?.error || "couldn't download"})`); continue; }
      if (res.size > MAX_ATTACHMENT_BYTES) { skipped.push(`${a.name} (${prettySize(res.size)}, over the ${prettySize(MAX_ATTACHMENT_BYTES)} limit)`); continue; }
      const blob = await (await fetch(res.dataUrl)).blob();
      const form = new FormData();
      form.set("client_id", clientId);
      form.set("file", new File([blob], a.name, { type: res.type || a.mime || "application/octet-stream" }));
      const up = await fetch(`${API_BASE}/api/extension/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const json = await up.json().catch(() => ({}));
      if (!up.ok || !json.path) { skipped.push(`${a.name} (${json.error || "upload failed"})`); continue; }
      files.push({ path: json.path, name: a.name, kind: (res.type || a.mime || "").startsWith("image/") ? "image" : "file" });
    } catch (e) {
      skipped.push(`${a.name} (${e instanceof Error ? e.message : "failed"})`);
    }
  }
  return { files, skipped };
}

/** Show the task(s) this page was already clipped into, rather than letting
 *  you make another copy without knowing. Best effort: a failed lookup leaves
 *  the panel exactly as it was, since a missing warning is a far smaller
 *  problem than a blocked capture. */
async function showAlreadyClipped(link) {
  clippedTasks = [];
  if (!link) return;
  const token = await getToken();
  if (!token) return;
  let tasks = [];
  try {
    ({ tasks } = await apiFetch(`/api/extension/tasks/by-link?link=${encodeURIComponent(link)}`, token));
  } catch { return; }
  if (!tasks?.length) return;
  clippedTasks = tasks;
  // Already clipped under a client nobody picked yet: that client is the answer.
  if (!selectedClientId && tasks[0].clientId) selectClient(tasks[0].clientId);
  renderTaskList();
}






// ---------------------------------------------------------------------------
// Site review (Derek, 2026-09-30, mockup A: "if I'm on a website I want to be
// able to pull up a client ... and add changes to a list very quickly if I
// review a local site or live site").
//
// On any page that is not Gmail the panel becomes a fast list: type a change,
// paste a screenshot, Enter. Each change lands at once on the site's "Website
// changes" task, as a checklist item plus a comment holding the page address
// and the screenshots (/api/extension/tasks/[id]/change). Nothing waits in the
// panel to be lost.
//
// The client, in order: the one you picked for this site before (server
// memory, "site:<host>"), the one the site's own CUL Feedback plugin files
// into, the client of an earlier "Website changes" task for this site, a
// contact's email domain, and last a guess from the site's name.

const siteHeadEl = document.getElementById("siteHead");
const siteHostEl = document.getElementById("siteHost");
const siteTagEl = document.getElementById("siteTag");
const sitePageEl = document.getElementById("sitePage");
const siteTopEl = document.getElementById("siteTop");
const siteBottomEl = document.getElementById("siteBottom");
const siteTargetTitleEl = document.getElementById("siteTargetTitle");
const siteTargetChangeBtn = document.getElementById("siteTargetChange");
const changeTextInput = document.getElementById("changeText");
const addChangeBtn = document.getElementById("addChange");
const siteDoneHeadEl = document.getElementById("siteDoneHead");
const siteDoneEl = document.getElementById("siteDone");
const panelNameEl = document.getElementById("panelName");
const sourceEl = document.getElementById("source");
const pasteZoneEl = document.getElementById("pasteZone");

let siteMode = false;
let site = null; // { host, origin, url, title }
// The task changes go on: { taskId, title } or null for "make one on the first change".
let siteTarget = null;
// The list the site's CUL Feedback plugin files into, used for a new task.
let pluginProjectId = null;
let siteDone = []; // [{ n, text, where, shots }] added to siteTarget, newest first

const isGmailUrl = (u) => /^https:\/\/mail\.google\.com\//.test(u || "");
function siteOf(tab) {
  const u = tab?.url || "";
  if (!/^https?:\/\//i.test(u) || isGmailUrl(u) || u.startsWith(API_BASE)) return null;
  try {
    const url = new URL(u);
    return { host: url.host.replace(/^www\./, ""), origin: url.origin, url: u, title: tab.title || "", path: url.pathname };
  } catch { return null; }
}
const isLocalHost = (h) => /(\.local|\.test|\.localhost)(:\d+)?$/.test(h) || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h);
const newTaskTitle = () => `Website changes: ${site.host}`;

function showSitePage() {
  siteHostEl.textContent = site.host;
  const local = isLocalHost(site.host);
  siteTagEl.textContent = local ? "LOCAL" : "LIVE";
  siteTagEl.className = `tag ${local ? "local" : "live"}`;
  sitePageEl.textContent = [site.title, site.path].filter(Boolean).join(" · ");
}

function leaveSiteMode() {
  siteMode = false;
  site = null;
  siteTarget = null;
  pluginProjectId = null;
  siteDone = [];
  panelNameEl.textContent = "ClickUpTasks";
  siteHeadEl.style.display = "none";
  siteTopEl.style.display = "none";
  siteBottomEl.style.display = "none";
  sourceEl.style.display = "";
  pasteZoneEl.textContent = "📋 Click here, then ⌘V to add a screenshot";
  newTaskBtn.textContent = "+ New task";
}

async function enterSiteMode(tab, token) {
  siteMode = true;
  site = siteOf(tab);
  panelNameEl.textContent = "Site review";
  sourceEl.style.display = "none";
  siteHeadEl.style.display = "";
  siteTopEl.style.display = "";
  siteBottomEl.style.display = "";
  pasteZoneEl.textContent = "📋 ⌘V a screenshot for this change";
  showView("none");
  showSitePage();
  renderSiteTarget();
  renderSiteDone();
  changeTextInput.value = "";
  changeTextInput.focus();
  // The origin is the link a "Website changes" task carries, so this finds the
  // one already made for this site, and its client with it.
  permalink = site.origin;
  await resolveSiteClient(token);
}

const HINT = {
  remembered: ["✓ Remembered for this site", ""],
  plugin: ["✓ From the site's CUL Feedback plugin", ""],
  task: ["✓ From this site's Website changes task", ""],
  domain: ["Guessed from a contact's email domain, check it", "guess"],
  name: ["Guessed from the site name, check it", "guess"],
};
function hint(kind) {
  const [text, cls] = HINT[kind];
  matchHintEl.textContent = text;
  matchHintEl.className = cls;
  clientSource = "server";
}
const canPick = (id) => allClients.some((c) => c.id === id);

async function resolveSiteClient(token) {
  const forHost = site.host;
  const [matched, plugin, byLink] = await Promise.all([
    apiFetch(`/api/extension/match-client?site=${encodeURIComponent(site.host)}`, token).then((r) => r.match).catch(() => null),
    askSitePlugin(site.origin),
    apiFetch(`/api/extension/tasks/by-link?link=${encodeURIComponent(site.origin)}`, token).then((r) => r.tasks || []).catch(() => []),
  ]);
  if (!siteMode || site?.host !== forHost) return; // moved on while this was out
  clippedTasks = byLink;
  // Its list only fits its own client; another client's task goes in that client's default list.
  pluginProjectId = plugin?.project_id ? { clientId: plugin.client_id, projectId: plugin.project_id } : null;
  if (matched?.matchType === "remembered" && canPick(matched.entryId || matched.clientId)) {
    selectClient(matched.entryId || matched.clientId); hint("remembered");
  } else if (plugin?.client_id && canPick(plugin.client_id)) {
    selectClient(plugin.client_id); hint("plugin");
  } else if (byLink[0]?.clientId && canPick(byLink[0].clientId)) {
    selectClient(byLink[0].clientId); hint("task");
  } else if (matched && canPick(matched.entryId || matched.clientId)) {
    selectClient(matched.entryId || matched.clientId); hint("domain");
  } else {
    const guess = guessClientFromHost(site.host);
    if (guess) { selectClient(guess.id); hint("name"); }
    else { renderSiteTarget(); }
  }
}

/** Ask the site which client it belongs to. Only a site with the CUL Feedback
 *  plugin (0.4.0 or later) answers; everything else fails fast and quietly. */
async function askSitePlugin(origin) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(`${origin}/wp-json/cul-feedback/v1/client`, { signal: ctrl.signal, credentials: "omit" });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.client_id === "string" && json.client_id ? json : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

/** jackflynn.local -> Jack Flynn. Only a single clear match counts. */
function guessClientFromHost(host) {
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const label = norm(host.replace(/:\d+$/, "").split(".")[0]);
  if (label.length < 4) return null;
  const people = allClients.filter((c) => c.kind !== "project");
  const names = (c) => [norm(c.name), norm(c.company)].filter((n) => n.length >= 4);
  const exact = people.filter((c) => names(c).includes(label));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const close = people.filter((c) => names(c).some((n) => (n.length >= 5 && label.includes(n)) || (label.length >= 5 && n.includes(label))));
  return close.length === 1 ? close[0] : null;
}

async function rememberClientForSite(entry) {
  if (!site || !entry) return;
  const token = await getToken();
  if (!token) return;
  try {
    await apiFetch("/api/extension/match-client", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: site.host, client_id: entry.kind === "project" ? entry.clientId : entry.id, entry_id: entry.kind === "project" ? entry.id : null }),
    });
  } catch { /* the memory is a convenience, never block on it */ }
}

// Where changes go for the selected client: the task you chose for this site
// last time, else the site's existing "Website changes" task, else a new one
// made on the first change.
async function resolveSiteTarget() {
  if (!siteMode || !selectedClientId) { siteTarget = null; renderSiteTarget(); return; }
  const { siteTargets = {} } = await chrome.storage.local.get("siteTargets");
  const saved = siteTargets[site.host];
  const existing = clippedTasks.find((t) => t.clientId === selectedClientId);
  if (saved && saved.clientId === selectedClientId) siteTarget = { taskId: saved.taskId, title: saved.title };
  else if (existing) siteTarget = { taskId: existing.id, title: existing.title };
  else siteTarget = null;
  await loadSiteDone();
  renderSiteTarget();
}

async function setSiteTarget(t) {
  siteTarget = t ? { taskId: t.id, title: t.title } : null;
  const { siteTargets = {} } = await chrome.storage.local.get("siteTargets");
  if (t) siteTargets[site.host] = { clientId: selectedClientId, taskId: t.id, title: t.title };
  else delete siteTargets[site.host];
  await chrome.storage.local.set({ siteTargets });
  showView("none");
  await loadSiteDone();
  renderSiteTarget();
  changeTextInput.focus();
}

function renderSiteTarget() {
  if (!siteMode) return;
  siteTargetChangeBtn.disabled = !selectedClientId;
  siteTargetTitleEl.textContent = !selectedClientId
    ? "Pick the client above first"
    : siteTarget ? siteTarget.title : `＋ New task: "${newTaskTitle()}"`;
  addChangeBtn.disabled = !selectedClientId;
}

siteTargetChangeBtn.addEventListener("click", () => {
  const open = pickViewEl.style.display !== "none";
  showView(open ? "none" : "pick");
  if (!open) { listHeadingEl.textContent = "Put the changes on"; newTaskBtn.textContent = "＋ New task"; }
});

// This session's changes on the current task, kept for the browser session so
// closing and reopening the panel still shows them.
const doneKey = () => `siteDone:${siteTarget?.taskId || ""}`;
async function loadSiteDone() {
  siteDone = [];
  if (siteTarget?.taskId) {
    const got = await chrome.storage.session.get(doneKey()).catch(() => ({}));
    siteDone = got[doneKey()] || [];
  }
  renderSiteDone();
}
function renderSiteDone(freshN = null) {
  siteDoneEl.innerHTML = "";
  if (!siteMode || !siteDone.length) { siteDoneHeadEl.style.display = "none"; return; }
  siteDoneHeadEl.style.display = "";
  siteDoneHeadEl.textContent = `Added this session (${siteDone.length}) · `;
  const a = document.createElement("a");
  a.href = `${API_BASE}/?task=${encodeURIComponent(siteTarget.taskId)}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = "Open the task";
  siteDoneHeadEl.append(a);
  for (const c of siteDone) {
    const row = document.createElement("div");
    row.className = `chg${c.n === freshN ? " fresh" : ""}`;
    const n = document.createElement("div");
    n.className = "n";
    n.textContent = String(c.n);
    const t = document.createElement("div");
    t.className = "t";
    const b = document.createElement("b");
    b.textContent = c.text;
    const s = document.createElement("span");
    s.textContent = [c.where, c.shots ? `${c.shots} screenshot${c.shots === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    t.append(b, s);
    row.append(n, t);
    siteDoneEl.append(row);
  }
}

async function addChange() {
  const text = changeTextInput.value.trim();
  if (!siteMode || addChangeBtn.disabled) return;
  if (!selectedClientId) { statusEl.textContent = "Pick the client first."; statusEl.className = "err"; return; }
  if (!text) { statusEl.textContent = "Type the change first."; statusEl.className = "err"; changeTextInput.focus(); return; }
  const token = await getToken();
  if (!token) return;
  const clientId = selectedClientId;
  const page = { ...site };
  const shots = [...capturedScreenshots];
  addChangeBtn.disabled = true;
  statusEl.textContent = shots.length ? "Uploading the screenshot…" : "Adding…";
  statusEl.className = "";
  try {
    const paths = [];
    for (const dataUrl of shots) paths.push(await uploadScreenshot(token, dataUrl, clientId));
    let r;
    try {
      r = await postChange(token, clientId, page, text, paths);
    } catch (e) {
      // The remembered task was finished or binned: make a fresh one, once.
      if (!/task is closed/.test(e?.message || "")) throw e;
      await setSiteTarget(null);
      r = await postChange(token, clientId, page, text, paths);
    }
    siteDone.unshift({ n: r.n, text, where: [page.title, page.path].filter(Boolean).join(" · "), shots: paths.length });
    await chrome.storage.session.set({ [doneKey()]: siteDone }).catch(() => {});
    // Only what was sent is cleared: anything typed or pasted meanwhile stays.
    if (changeTextInput.value.trim() === text) changeTextInput.value = "";
    capturedScreenshots = capturedScreenshots.filter((s) => !shots.includes(s));
    renderScreenshotGallery();
    statusEl.textContent = "";
    renderSiteDone(r.n);
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : "Couldn't add that change.";
    statusEl.className = "err";
  } finally {
    addChangeBtn.disabled = !selectedClientId;
    changeTextInput.focus();
  }
}
/** One change onto the target task, making the "Website changes" task first
 *  when this site has none yet. */
async function postChange(token, clientId, page, text, paths) {
  if (!siteTarget) {
    statusEl.textContent = "Making the Website changes task…";
    const created = await apiFetch("/api/extension/tasks", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId, project_id: pluginProjectId?.clientId === clientId ? pluginProjectId.projectId : undefined, title: newTaskTitle(),
        description: `Changes from a review of ${page.origin}`, link: page.origin,
        due: DEFAULT_DUE(), follow_up_at: DEFAULT_FOLLOW_UP(), priority: "normal",
      }),
    });
    await setSiteTarget({ id: created.id, title: created.title || newTaskTitle() });
  }
  return apiFetch(`/api/extension/tasks/${encodeURIComponent(siteTarget.taskId)}/change`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, url: page.url, page_title: page.title, screenshot_paths: paths }),
  });
}
addChangeBtn.addEventListener("click", () => void addChange());
changeTextInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); void addChange(); }
});

// Follow the browser. Moving to another page on the same site only updates the
// page line, so a change half typed survives it; another site (or leaving
// Gmail for one) starts over. Gmail to Gmail stays on Refresh, as before.
// The host an init() is already starting for: a page load fires several
// updates (address, title, complete) and one start over is enough.
let movingTo = null;
async function onTabMoved() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const next = siteOf(tab);
  if (siteMode && next && next.host === site.host) { site = next; permalink = site.origin; showSitePage(); return; }
  if (!siteMode && !next) return;
  const key = next?.host ?? "(not a site)";
  if (movingTo === key) return;
  movingTo = key;
  try { await init(); } finally { movingTo = null; }
}
chrome.tabs.onActivated.addListener(() => void onTabMoved());
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.url || info.status === "complete" || info.title)) void onTabMoved();
});
