const API_BASE = "https://clickuptasks.vercel.app";

const formEl = document.getElementById("form");
const needsTokenEl = document.getElementById("needsToken");
const clientSel = document.getElementById("client");
const matchHintEl = document.getElementById("matchHint");
const projectSel = document.getElementById("project");
const titleInput = document.getElementById("title");
const notesInput = document.getElementById("notes");
const statusEl = document.getElementById("status");
const createBtn = document.getElementById("create");
const enrichBtn = document.getElementById("enrich");
const refreshBtn = document.getElementById("refresh");

let permalink = null;
let senderName = null;
let senderEmail = null;

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

clientSel.addEventListener("change", () => loadProjectsFor(clientSel.value));

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

  const [email, clients] = await Promise.all([getCurrentEmail(), loadClients(token).catch(() => [])]);

  clientSel.innerHTML = "";
  const blankOpt = document.createElement("option");
  blankOpt.value = "";
  blankOpt.textContent = clients.length ? "Select a client…" : "No clients available";
  clientSel.appendChild(blankOpt);
  for (const c of clients) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    clientSel.appendChild(opt);
  }
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
          clientSel.value = match.clientId;
          matchHintEl.textContent = match.matchType === "domain"
            ? `Auto-selected via company domain — please verify`
            : `Auto-selected — matched sender's email`;
          await loadProjectsFor(match.clientId);
        }
      } catch { /* no match — leave the dropdown unselected */ }
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
  const clientId = clientSel.value;
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
      body: JSON.stringify({ client_id: clientId, project_id: projectSel.value || undefined, title, description: notesInput.value.trim(), link: permalink }),
    });
    statusEl.textContent = "Task created.";
    statusEl.className = "ok";
    // The panel stays open (it's a sidebar, not a popup) — clear the form
    // instead of trying to close anything, ready for the next email.
    titleInput.value = "";
    notesInput.value = "";
    clientSel.value = "";
    projectSel.value = "";
    matchHintEl.textContent = "";
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : "Failed to create task.";
    statusEl.className = "err";
  } finally {
    createBtn.disabled = false;
  }
});

init();
