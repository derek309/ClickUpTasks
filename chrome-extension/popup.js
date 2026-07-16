const API_BASE = "https://clickuptasks.vercel.app";

const formEl = document.getElementById("form");
const needsTokenEl = document.getElementById("needsToken");
const clientSel = document.getElementById("client");
const titleInput = document.getElementById("title");
const notesInput = document.getElementById("notes");
const statusEl = document.getElementById("status");
const createBtn = document.getElementById("create");

let permalink = null;

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
  // Cache for a few minutes so reopening the popup repeatedly doesn't
  // re-fetch every time.
  const cached = await chrome.storage.local.get(["clientsCache", "clientsCacheAt"]);
  const fresh = cached.clientsCacheAt && Date.now() - cached.clientsCacheAt < 5 * 60 * 1000;
  if (fresh && cached.clientsCache) return cached.clientsCache;
  const { clients } = await apiFetch("/api/extension/clients", token);
  await chrome.storage.local.set({ clientsCache: clients, clientsCacheAt: Date.now() });
  return clients;
}

async function init() {
  const token = await getToken();
  if (!token) {
    formEl.style.display = "none";
    needsTokenEl.style.display = "block";
    return;
  }

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

  if (email) {
    titleInput.value = email.subject || "";
    const fromLine = email.senderName || email.senderEmail ? `From: ${email.senderName || ""}${email.senderEmail ? ` <${email.senderEmail}>` : ""}` : "";
    notesInput.value = [fromLine, email.snippet || ""].filter(Boolean).join("\n\n");
    permalink = email.permalink || null;

    if (email.senderEmail) {
      try {
        const { match } = await apiFetch(`/api/extension/match-client?email=${encodeURIComponent(email.senderEmail)}`, token);
        if (match) clientSel.value = match.clientId;
      } catch { /* no match — leave the dropdown unselected */ }
    }
  } else {
    // Either this tab isn't Gmail, the content script hasn't loaded yet
    // (a tab open before the extension was installed needs a reload), or
    // Gmail's page structure changed under us — say so instead of leaving
    // a blank form with no explanation.
    statusEl.textContent = "Couldn't read this email automatically — fill in manually, or reload the Gmail tab and try again.";
    statusEl.className = "";
  }
}

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
      body: JSON.stringify({ client_id: clientId, title, description: notesInput.value.trim(), link: permalink }),
    });
    statusEl.textContent = "Task created.";
    statusEl.className = "ok";
    setTimeout(() => window.close(), 900);
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : "Failed to create task.";
    statusEl.className = "err";
    createBtn.disabled = false;
  }
});

init();
