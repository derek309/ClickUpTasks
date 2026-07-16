const API_BASE = "https://clickuptasks.vercel.app";

const formEl = document.getElementById("form");
const needsTokenEl = document.getElementById("needsToken");
const clientSearchInput = document.getElementById("clientSearch");
const clientResultsEl = document.getElementById("clientResults");
const matchHintEl = document.getElementById("matchHint");
const projectSel = document.getElementById("project");
const dueInput = document.getElementById("due");
const prioritySel = document.getElementById("priority");
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

function clientLabel(c) {
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
      const subBits = [c.company, c.contactName ? `Contact: ${c.contactName}` : null].filter(Boolean);
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
  selectedClientId = id;
  clientSearchInput.value = c ? clientLabel(c) : "";
  clientResultsEl.classList.remove("open");
  loadProjectsFor(id);
}

clientSearchInput.addEventListener("input", () => {
  selectedClientId = ""; // typing invalidates any prior selection/auto-match
  matchHintEl.textContent = "";
  renderClientResults(clientSearchInput.value);
});
clientSearchInput.addEventListener("focus", () => renderClientResults(clientSearchInput.value));
clientSearchInput.addEventListener("blur", () => clientResultsEl.classList.remove("open"));

// A side panel stays open as you browse between emails (unlike a popup,
// which closes on any click outside it) — Refresh re-reads whatever's
// currently open in Gmail instead of requiring a full reload.
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

  const [email, clients] = await Promise.all([getCurrentEmail(), loadClients(token).catch(() => [])]);
  allClients = clients;
  clientSearchInput.placeholder = clients.length ? "Search by name, business, or contact…" : "No clients available";
  await loadProjectsFor("");

  if (email) {
    titleInput.value = email.subject || "";
    senderName = email.senderName || null;
    senderEmail = email.senderEmail || null;
    const fromLine = senderName || senderEmail ? `From: ${senderName || ""}${senderEmail ? ` <${senderEmail}>` : ""}` : "";
    notesInput.value = [fromLine, email.snippet || ""].filter(Boolean).join("\n\n");
    permalink = email.permalink || null;

    if (senderEmail) {
      try {
        const { match } = await apiFetch(`/api/extension/match-client?email=${encodeURIComponent(senderEmail)}`, token);
        if (match) {
          selectClient(match.clientId);
          matchHintEl.textContent = match.matchType === "domain"
            ? `Auto-selected via company domain — please verify`
            : `Auto-selected — matched sender's email`;
        }
      } catch { /* no match — leave the picker empty */ }
    }
  } else {
    permalink = null;
    senderName = null;
    senderEmail = null;
    // Either this tab isn't Gmail, the content script hasn't loaded yet
    // (a tab open before the extension was installed needs a reload), or
    // Gmail's page structure changed under us — say so instead of leaving
    // a blank form with no explanation.
    statusEl.textContent = "Couldn't read this email automatically — fill in manually, or reload the Gmail tab and try again.";
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

createBtn.addEventListener("click", async () => {
  const token = await getToken();
  if (!token) return;
  const clientId = selectedClientId;
  const title = titleInput.value.trim();
  if (!clientId || !title) {
    statusEl.textContent = "Pick a client and enter a title.";
    statusEl.className = "err";
    return;
  }
  createBtn.disabled = true;
  statusEl.textContent = "Creating…";
  statusEl.className = "";
  try {
    await apiFetch("/api/extension/tasks", token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId, project_id: projectSel.value || undefined, title, description: notesInput.value.trim(), link: permalink,
        due: dueInput.value || undefined, priority: prioritySel.value,
      }),
    });
    statusEl.textContent = "Task created.";
    statusEl.className = "ok";
    // The panel stays open (it's a sidebar, not a popup) — clear the form
    // instead of trying to close anything, ready for the next email.
    titleInput.value = "";
    notesInput.value = "";
    selectedClientId = "";
    clientSearchInput.value = "";
    projectSel.value = "";
    dueInput.value = "";
    prioritySel.value = "normal";
    matchHintEl.textContent = "";
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : "Failed to create task.";
    statusEl.className = "err";
  } finally {
    createBtn.disabled = false;
  }
});

init();
