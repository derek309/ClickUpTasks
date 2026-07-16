const API_BASE = "https://clickuptasks.vercel.app";

const formEl = document.getElementById("form");
const needsTokenEl = document.getElementById("needsToken");
const clientSearchInput = document.getElementById("clientSearch");
const clientResultsEl = document.getElementById("clientResults");
const matchHintEl = document.getElementById("matchHint");
const screenshotBoxEl = document.getElementById("screenshotBox");
const screenshotPreviewEl = document.getElementById("screenshotPreview");
const removeScreenshotBtn = document.getElementById("removeScreenshot");
const modeNewBtn = document.getElementById("modeNew");
const modeExistingBtn = document.getElementById("modeExisting");
const newTaskFieldsEl = document.getElementById("newTaskFields");
const existingTaskFieldsEl = document.getElementById("existingTaskFields");
const taskSearchInput = document.getElementById("taskSearch");
const taskResultsEl = document.getElementById("taskResults");
const projectSel = document.getElementById("project");
const dueInput = document.getElementById("due");
const prioritySel = document.getElementById("priority");
const assigneeSel = document.getElementById("assignee");
const titleLabelEl = document.getElementById("titleLabel");
const titleInput = document.getElementById("title");
const notesInput = document.getElementById("notes");
const statusEl = document.getElementById("status");
const createBtn = document.getElementById("create");
const enrichBtn = document.getElementById("enrich");
const refreshBtn = document.getElementById("refresh");

let permalink = null;
let senderName = null;
let senderEmail = null;
let allClients = []; // [{id, name, company, contactName}]
let selectedClientId = "";
let capturedScreenshot = null; // data URL, or null
let mode = "new"; // "new" | "existing"
let allTasks = []; // [{id, title, status}] for the current client
let selectedTaskId = "";

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

function showScreenshot(dataUrl) {
  capturedScreenshot = dataUrl;
  if (dataUrl) {
    screenshotPreviewEl.src = dataUrl;
    screenshotBoxEl.classList.add("has-shot");
  } else {
    screenshotBoxEl.classList.remove("has-shot");
  }
}
removeScreenshotBtn.addEventListener("click", () => showScreenshot(null));

async function loadClients(token) {
  // Cache for a few minutes so reopening the panel repeatedly doesn't
  // re-fetch every time.
  const cached = await chrome.storage.local.get(["clientsCache", "clientsCacheAt"]);
  const fresh = cached.clientsCacheAt && Date.now() - cached.clientsCacheAt < 5 * 60 * 1000;
  if (fresh && cached.clientsCache) return cached.clientsCache;
  const { clients } = await apiFetch("/api/extension/clients", token);
  await chrome.storage.local.set({ clientsCache: clients, clientsCacheAt: Date.now() });
  return clients;
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
    }
  } catch { /* leave just "Default" — task creation still works via the fallback */ }
}

async function loadTasksFor(clientId) {
  allTasks = [];
  selectedTaskId = "";
  taskSearchInput.value = "";
  if (!clientId) return;
  const token = await getToken();
  if (!token) return;
  try {
    const { tasks } = await apiFetch(`/api/extension/tasks?client_id=${encodeURIComponent(clientId)}`, token);
    allTasks = tasks;
  } catch { /* leave empty — search will just show "No matches" */ }
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
      row.addEventListener("mousedown", (e) => { e.preventDefault(); selectClient(c.id); });
      clientResultsEl.appendChild(row);
    }
  }
  clientResultsEl.classList.add("open");
}

function selectClient(id) {
  const c = allClients.find((x) => x.id === id);
  if (!c) return;
  clientSearchInput.value = clientLabel(c);
  clientResultsEl.classList.remove("open");
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
}

clientSearchInput.addEventListener("input", () => {
  selectedClientId = ""; // typing invalidates any prior selection/auto-match
  matchHintEl.textContent = "";
  renderClientResults(clientSearchInput.value);
});
clientSearchInput.addEventListener("focus", () => renderClientResults(clientSearchInput.value));
clientSearchInput.addEventListener("blur", () => clientResultsEl.classList.remove("open"));

function renderTaskResults(query) {
  const q = query.trim().toLowerCase();
  const matches = !q ? allTasks : allTasks.filter((t) => t.title.toLowerCase().includes(q));
  taskResultsEl.innerHTML = "";
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "result-row";
    empty.style.cssText = "color:#94a3b8;cursor:default;";
    empty.textContent = selectedClientId ? "No matching open tasks" : "Pick a client first";
    taskResultsEl.appendChild(empty);
  } else {
    for (const t of matches.slice(0, 50)) {
      const row = document.createElement("div");
      row.className = "result-row";
      row.textContent = t.title;
      row.addEventListener("mousedown", (e) => { e.preventDefault(); selectTask(t.id); });
      taskResultsEl.appendChild(row);
    }
  }
  taskResultsEl.classList.add("open");
}

function selectTask(id) {
  const t = allTasks.find((x) => x.id === id);
  selectedTaskId = id;
  taskSearchInput.value = t ? t.title : "";
  taskResultsEl.classList.remove("open");
}

taskSearchInput.addEventListener("input", () => {
  selectedTaskId = "";
  renderTaskResults(taskSearchInput.value);
});
taskSearchInput.addEventListener("focus", () => renderTaskResults(taskSearchInput.value));
taskSearchInput.addEventListener("blur", () => taskResultsEl.classList.remove("open"));

function setMode(next) {
  mode = next;
  modeNewBtn.classList.toggle("active", mode === "new");
  modeExistingBtn.classList.toggle("active", mode === "existing");
  newTaskFieldsEl.style.display = mode === "new" ? "" : "none";
  existingTaskFieldsEl.style.display = mode === "existing" ? "" : "none";
  titleLabelEl.style.display = mode === "new" ? "" : "none";
  titleInput.style.display = mode === "new" ? "" : "none";
  createBtn.textContent = mode === "new" ? "Create Task" : "Add to Task";
}
modeNewBtn.addEventListener("click", () => setMode("new"));
modeExistingBtn.addEventListener("click", () => setMode("existing"));

// A side panel stays open as you browse (unlike a popup, which closes on
// any click outside it) — Refresh re-reads whatever's currently open
// instead of requiring a full reload. The toolbar icon itself also opens
// (or brings forward) the panel via background.js, which always captures a
// fresh screenshot first — see that file for why it has to happen there
// and not from a button in here.
async function init() {
  const token = await getToken();
  if (!token) {
    formEl.style.display = "none";
    needsTokenEl.style.display = "block";
    return;
  }
  formEl.style.display = "";
  needsTokenEl.style.display = "none";
  statusEl.textContent = "";
  statusEl.className = "";
  matchHintEl.textContent = "";
  selectedClientId = "";
  clientSearchInput.value = "";
  dueInput.value = "";
  prioritySel.value = "normal";
  assigneeSel.value = "";
  showScreenshot(null);
  setMode("new");

  const [email, capture, clients] = await Promise.all([
    getCurrentEmail(), getPendingCapture(), loadClients(token).catch(() => []), loadMembers(token).catch(() => {}),
  ]);
  allClients = clients;
  clientSearchInput.placeholder = clients.length ? "Search by name, business, or contact…" : "No clients available";
  await loadProjectsFor("");
  await loadTasksFor("");

  if (capture?.screenshot) showScreenshot(capture.screenshot);

  if (email) {
    // Gmail — same as before, takes priority over the generic page capture.
    titleInput.value = email.subject || "";
    senderName = email.senderName || null;
    senderEmail = email.senderEmail || null;
    const fromLine = senderName || senderEmail ? `From: ${senderName || ""}${senderEmail ? ` <${senderEmail}>` : ""}` : "";
    notesInput.value = [fromLine, email.snippet || ""].filter(Boolean).join("\n\n");
    permalink = email.permalink || null;
  } else if (capture) {
    // Any other page — title/URL are native tab properties, no scraping
    // needed. Notes stays blank; the screenshot is the main content here.
    titleInput.value = capture.title || "";
    senderName = null;
    senderEmail = null;
    notesInput.value = "";
    permalink = capture.url || null;
  } else {
    permalink = null;
    senderName = null;
    senderEmail = null;
  }

  if (senderEmail) {
    try {
      const { match } = await apiFetch(`/api/extension/match-client?email=${encodeURIComponent(senderEmail)}`, token);
      if (match) {
        selectClient(match.clientId);
        matchHintEl.textContent = match.matchType === "domain" ? `Auto-selected via company domain — please verify` : `Auto-selected — matched sender's email`;
      }
    } catch { /* no match — leave the picker empty */ }
  } else if (!email && permalink) {
    // Only for the generic-page capture path — a Gmail email with no
    // detected sender shouldn't fall back to matching mail.google.com's
    // own domain against a client.
    try {
      const domain = new URL(permalink).hostname;
      const { match } = await apiFetch(`/api/extension/match-client?domain=${encodeURIComponent(domain)}`, token);
      if (match) {
        selectClient(match.clientId);
        matchHintEl.textContent = `Auto-selected — matched this page's domain`;
      }
    } catch { /* not a valid URL, or no match — leave the picker empty */ }
  }

  if (!email && !capture) {
    // Either this tab can't be read at all (a chrome:// page, capture
    // failed and it's not Gmail), the content script hasn't loaded yet (a
    // Gmail tab open before the extension was installed needs a reload), or
    // Gmail's page structure changed under us — say so instead of leaving a
    // blank form with no explanation.
    statusEl.textContent = "Couldn't read this page automatically — fill in manually, or reload the tab and try again.";
    statusEl.className = "";
  }
}

refreshBtn.addEventListener("click", init);

enrichBtn.addEventListener("click", async () => {
  const token = await getToken();
  if (!token) return;
  enrichBtn.disabled = true;
  enrichBtn.textContent = "Enriching…";
  try {
    const { title, description } = await apiFetch("/api/extension/enrich", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: titleInput.value, senderName, senderEmail, body: notesInput.value }),
    });
    titleInput.value = title;
    notesInput.value = description;
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : "AI enrichment failed.";
    statusEl.className = "err";
  } finally {
    enrichBtn.disabled = false;
    enrichBtn.textContent = "✨ Enrich with AI";
  }
});

function resetFormAfterSubmit() {
  titleInput.value = "";
  notesInput.value = "";
  selectedClientId = "";
  clientSearchInput.value = "";
  projectSel.value = "";
  dueInput.value = "";
  prioritySel.value = "normal";
  assigneeSel.value = "";
  matchHintEl.textContent = "";
  showScreenshot(null);
  selectedTaskId = "";
  taskSearchInput.value = "";
  allTasks = [];
  setMode("new");
}

createBtn.addEventListener("click", async () => {
  const token = await getToken();
  if (!token) return;
  const clientId = selectedClientId;
  if (!clientId) {
    statusEl.textContent = "Pick a client.";
    statusEl.className = "err";
    return;
  }
  if (mode === "new" && !titleInput.value.trim()) {
    statusEl.textContent = "Enter a title.";
    statusEl.className = "err";
    return;
  }
  if (mode === "existing" && !selectedTaskId) {
    statusEl.textContent = "Pick a task to add this to.";
    statusEl.className = "err";
    return;
  }

  createBtn.disabled = true;
  statusEl.textContent = mode === "new" ? "Creating…" : "Adding…";
  statusEl.className = "";
  try {
    let screenshotPath;
    if (capturedScreenshot) screenshotPath = await uploadScreenshot(token, capturedScreenshot, clientId);

    if (mode === "new") {
      await apiFetch("/api/extension/tasks", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId, project_id: projectSel.value || undefined, title: titleInput.value.trim(), description: notesInput.value.trim(), link: permalink,
          due: dueInput.value || undefined, priority: prioritySel.value, assignee_id: assigneeSel.value || undefined, screenshot_path: screenshotPath,
        }),
      });
      statusEl.textContent = "Task created.";
    } else {
      await apiFetch(`/api/extension/tasks/${encodeURIComponent(selectedTaskId)}/comment`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: notesInput.value.trim(), screenshot_path: screenshotPath }),
      });
      statusEl.textContent = "Added to task.";
    }
    statusEl.className = "ok";
    // The panel stays open (it's a sidebar, not a popup) — clear the form
    // instead of trying to close anything, ready for the next page.
    resetFormAfterSubmit();
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : "Failed.";
    statusEl.className = "err";
  } finally {
    createBtn.disabled = false;
  }
});

init();
