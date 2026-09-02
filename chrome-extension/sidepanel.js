
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
const modeNewBtn = document.getElementById("modeNew");
const modeExistingBtn = document.getElementById("modeExisting");
const newTaskFieldsEl = document.getElementById("newTaskFields");
const existingTaskFieldsEl = document.getElementById("existingTaskFields");
const taskSearchInput = document.getElementById("taskSearch");
const taskResultsEl = document.getElementById("taskResults");
const projectSel = document.getElementById("project");
const existingProjectSel = document.getElementById("existingProject");
const dueInput = document.getElementById("due");
const prioritySel = document.getElementById("priority");
const assigneeSel = document.getElementById("assignee");
const titleLabelEl = document.getElementById("titleLabel");
const titleInput = document.getElementById("title");
const notesInput = document.getElementById("notes");
const statusEl = document.getElementById("status");
const createBtn = document.getElementById("create");
const enrichBtn = document.getElementById("enrich");
const clippedEl = document.getElementById("alreadyClipped");
const clippedListEl = document.getElementById("alreadyClippedList");
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
let capturedScreenshots = []; // data URLs, in the order added
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
      if (typeof res.attempted === "number" && res.attempted !== res.imported) {
        statusEl.textContent = `Thread bound, but ${res.attempted - res.imported} message(s) did not save. Thread ${res.threadId}.`;
        statusEl.className = "err";
        return;
      }
      statusEl.textContent = res.confident
        ? `Watching this thread — ${count}.`
        : `Matched by subject — ${count}. Check it is the right thread.`;
      statusEl.className = "ok";
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
  existingProjectSel.innerHTML = '<option value="">All lists</option>';
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
      // The same lists, for narrowing the task search. A client with a dozen
      // lists has far too many open tasks to scan as one flat list.
      existingProjectSel.appendChild(opt.cloneNode(true));
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
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectClient(c.id);
        rememberClientForSender(senderEmail, c.id);
        maybeAutoEnrich();
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
// Kept in chrome.storage.local, never synced: it's a convenience cache keyed
// to email addresses, not something worth putting on Google's servers.
const SENDER_MEMORY_KEY = "senderClientMap";
const SENDER_MEMORY_MAX = 200;

async function rememberClientForSender(email, clientEntryId) {
  if (!email || !clientEntryId) return;
  try {
    const store = await chrome.storage.local.get(SENDER_MEMORY_KEY);
    const map = store[SENDER_MEMORY_KEY] || {};
    map[email.toLowerCase()] = { id: clientEntryId, at: Date.now() };
    // Prune oldest first so a long-lived install can't grow without bound.
    const keys = Object.keys(map);
    if (keys.length > SENDER_MEMORY_MAX) {
      keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0))
          .slice(0, keys.length - SENDER_MEMORY_MAX)
          .forEach((k) => delete map[k]);
    }
    await chrome.storage.local.set({ [SENDER_MEMORY_KEY]: map });
  } catch { /* storage unavailable — the picker still works by hand */ }
}

async function recalledClientForSender(email) {
  if (!email) return null;
  try {
    const store = await chrome.storage.local.get(SENDER_MEMORY_KEY);
    const hit = (store[SENDER_MEMORY_KEY] || {})[email.toLowerCase()];
    // Only honour it if that client is still on the roster — one may have been
    // renamed, merged, or removed since we wrote it down.
    return hit && allClients.some((c) => c.id === hit.id) ? hit.id : null;
  } catch { return null; }
}

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function selectClient(id) {
  const c = allClients.find((x) => x.id === id);
  if (!c) return;
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
}

clientSearchInput.addEventListener("input", () => {
  selectedClientId = ""; // typing invalidates any prior selection/auto-match
  matchHintEl.textContent = "";
  renderClientResults(clientSearchInput.value);
});
clientSearchInput.addEventListener("focus", () => renderClientResults(clientSearchInput.value));
clientSearchInput.addEventListener("blur", () => clientResultsEl.classList.remove("open"));

function listNameFor(projectId) {
  if (!projectId) return "";
  const opt = [...existingProjectSel.options].find((o) => o.value === projectId);
  return opt ? opt.textContent : "";
}

function renderTaskResults(query) {
  const q = query.trim().toLowerCase();
  const list = existingProjectSel.value;
  const inList = list ? allTasks.filter((t) => t.projectId === list) : allTasks;
  const matches = !q ? inList : inList.filter((t) => t.title.toLowerCase().includes(q));
  taskResultsEl.innerHTML = "";
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "result-row";
    empty.style.cssText = "color:#94a3b8;cursor:default;";
    empty.textContent = !selectedClientId
      ? "Pick a client first"
      : (existingProjectSel.value ? "No matching open tasks in this list" : "No matching open tasks");
    taskResultsEl.appendChild(empty);
  } else {
    for (const t of matches.slice(0, 50)) {
      const row = document.createElement("div");
      row.className = "result-row";
      row.textContent = t.title;
      // Which list it is in, when the search spans all of them: two tasks
      // called "Website" under different lists are otherwise one row twice.
      const listName = !list && listNameFor(t.projectId);
      if (listName) {
        const tag = document.createElement("span");
        tag.textContent = listName;
        tag.style.cssText = "color:#64748b;font-size:11px;margin-left:6px;";
        row.appendChild(tag);
      }
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
existingProjectSel.addEventListener("change", () => {
  // Changing the list invalidates a task chosen from a different one.
  selectedTaskId = "";
  taskSearchInput.value = "";
  renderTaskResults("");
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
  autoEnrichDone = false;
  needsTokenEl.style.display = "none";
  statusEl.textContent = "";
  statusEl.className = "";
  matchHintEl.textContent = "";
  addContactEl.style.display = "none";
  selectedClientId = "";
  clientSearchInput.value = "";
  emailAttachments = [];
  renderEmailAttachments();
  clippedListEl.innerHTML = "";
  clippedEl.style.display = "none";
  dueInput.value = tomorrowIso();
  prioritySel.value = "normal";
  assigneeSel.value = "";
  clearScreenshots();
  setMode("new");

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

  if (email) {
    // Gmail — same as before, takes priority over the generic tab data.
    titleInput.value = email.subject || "";
    senderName = email.senderName || null;
    senderEmail = email.senderEmail || null;
    const fromLine = senderName || senderEmail ? `From: ${senderName || ""}${senderEmail ? ` <${senderEmail}>` : ""}` : "";
    notesInput.value = [fromLine, email.snippet || ""].filter(Boolean).join("\n\n");
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
    senderName = null;
    senderEmail = null;
    emailAttachments = [];
    renderEmailAttachments();
    notesInput.value = "";
    permalink = tab?.url || null;
    void showAlreadyClipped(permalink);
  }

  if (senderEmail) {
    const recalled = await recalledClientForSender(senderEmail);
    if (recalled) {
      // Beats the server lookup on purpose — you picked this yourself last
      // time for this exact sender, which outranks a contact or domain guess.
      selectClient(recalled);
      matchHintEl.textContent = "Auto-selected — remembered from last time";
      return;
    }
    try {
      const { match } = await apiFetch(`/api/extension/match-client?email=${encodeURIComponent(senderEmail)}`, token);
      if (match) {
        selectClient(match.clientId);
        matchHintEl.textContent = match.matchType === "domain" ? `Auto-selected via company domain — please verify` : `Auto-selected — matched sender's email`;
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
        selectClient(match.clientId);
        matchHintEl.textContent = `Auto-selected — matched this page's domain`;
      }
    } catch { /* not a valid URL, or no match — leave the picker empty */ }
  }

  if (!email && !tab?.title && !permalink) {
    // Rare: this tab can't be read at all (a chrome:// page) and there's no
    // Gmail email either — the form still opens, fully fillable by hand.
    statusEl.textContent = "Couldn't read this page — fill in the form manually below.";
    statusEl.className = "";
  }
}

refreshBtn.addEventListener("click", () => init(true));

// Set once a capture has been enriched, so picking a different client
// afterwards doesn't fire the AI again and overwrite what's on screen.
// Cleared whenever the form is reset or repopulated.
let autoEnrichDone = false;

// Fires when a client is picked from the dropdown (Derek: "make it so enrich
// with AI auto runs when we select a contact from the dropdown"). Deliberately
// NOT wired to the auto-match on panel open: that would spend an AI call every
// time the panel is opened, including the times you open it and close it
// again. Skipped when there's nothing to work with, and skipped once it has
// already run for this capture, since it overwrites Title and Notes and would
// otherwise wipe edits made after the first run. The button re-runs it by hand
// any time.
function maybeAutoEnrich() {
  if (autoEnrichDone || enrichBtn.disabled) return;
  if (!titleInput.value.trim() && !notesInput.value.trim()) return;
  autoEnrichDone = true;
  runEnrich();
}

async function runEnrich() {
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
}

enrichBtn.addEventListener("click", () => { autoEnrichDone = true; runEnrich(); });

function resetFormAfterSubmit() {
  autoEnrichDone = false;
  titleInput.value = "";
  notesInput.value = "";
  selectedClientId = "";
  clientSearchInput.value = "";
  emailAttachments = [];
  renderEmailAttachments();
  clippedListEl.innerHTML = "";
  clippedEl.style.display = "none";
  projectSel.value = "";
  dueInput.value = tomorrowIso();
  prioritySel.value = "normal";
  assigneeSel.value = "";
  matchHintEl.textContent = "";
  clearScreenshots();
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
  // Learn the client from what you actually filed against, not only from
  // adding a brand new contact (Derek: "when I pick a client and create a
  // task have it remember that client and preselect when I open another email
  // from them"). Picking a client and pressing Create is the strongest signal
  // there is about who a sender belongs to — stronger than the server's
  // contact or domain guess, which is why the recall above beats it.
  //
  // Before the request rather than after: the point is the association, and
  // it should survive a task that fails to save for some unrelated reason.
  void rememberClientForSender(senderEmail, clientId);
  try {
    const screenshotPaths = [];
    for (const dataUrl of capturedScreenshots) screenshotPaths.push(await uploadScreenshot(token, dataUrl, clientId));
    const attCount = emailAttachments.filter((a) => a.keep).length;
    if (attCount) { statusEl.textContent = `Fetching ${attCount} attachment${attCount === 1 ? "" : "s"}…`; }
    const { files, skipped } = await uploadEmailAttachments(token, clientId);

    if (mode === "new") {
      const created = await apiFetch("/api/extension/tasks", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId, project_id: projectSel.value || undefined, title: titleInput.value.trim(), description: notesInput.value.trim(), link: permalink,
          due: dueInput.value || undefined, priority: prioritySel.value, assignee_id: assigneeSel.value || undefined, screenshot_paths: screenshotPaths, files,
        }),
      });
      // Link straight to what was just made (Derek: "make a link to it so I
      // can click and go to it"). The panel clears itself immediately after
      // this, so without a link the task you just created is gone from view
      // with nothing to click. Opens in a new tab: this is a side panel, and
      // navigating it away would close the form you're still working in.
      showCreatedLink(created?.id, created?.title || titleInput.value.trim(), skipped);
      await attachEmailThread(token, created?.id);
    } else {
      await apiFetch(`/api/extension/tasks/${encodeURIComponent(selectedTaskId)}/comment`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: notesInput.value.trim(), screenshot_paths: screenshotPaths }),
      });
      await attachEmailThread(token, selectedTaskId);
      statusEl.textContent = "Added to task.";
      statusEl.className = "ok";
    }
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

// The side panel is persistent — clicking the toolbar icon while it's
// already open calls chrome.sidePanel.open() on the SAME document instead of
// reloading it, so init()'s one-time read of pendingCapture never sees a
// second capture. background.js still writes the new capture to storage on
// every click, so watch for that write directly and re-run init() to pick
// it up, covering both "panel was already open" and (harmlessly, since
// init() already consumed it before this listener could see the same write)
// the fresh-open case.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.pendingCapture?.newValue) init();
});

init();


// ---------------------------------------------------------------------------

// Attachments found on the open Gmail message: [{ name, mime, url, keep }].
// Downloaded only on submit, and only the ticked ones.
let emailAttachments = [];









/** "Task created" plus a link to the thing itself. Built as real DOM rather
 *  than innerHTML so a task title containing < or & can't inject markup into
 *  the panel. Falls back to plain text if the API didn't hand back an id. */
function showCreatedLink(taskId, title, skipped = []) {
  statusEl.textContent = "";
  statusEl.className = "ok";
  if (!taskId) { statusEl.textContent = "Task created."; return; }
  statusEl.append("Task created. ");
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
  clippedListEl.innerHTML = "";
  clippedEl.style.display = "none";
  if (!link) return;
  const token = await getToken();
  if (!token) return;
  let tasks = [];
  try {
    ({ tasks } = await apiFetch(`/api/extension/tasks/by-link?link=${encodeURIComponent(link)}`, token));
  } catch { return; }
  if (!tasks?.length) return;

  clippedEl.style.display = "";
  for (const t of tasks) {
    const row = document.createElement("div");
    row.className = "clip-row";
    const title = document.createElement("span");
    title.className = "t";
    title.textContent = t.title;
    title.title = t.title;
    const open = document.createElement("a");
    open.href = `${API_BASE}/?task=${encodeURIComponent(t.id)}`;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "Open";
    // Straight into "add a comment to this task" with it already chosen —
    // the thing you almost always want when a page is already clipped.
    const addTo = document.createElement("button");
    addTo.type = "button";
    addTo.className = "linkish";
    addTo.textContent = "Add to it";
    addTo.addEventListener("click", async () => {
      if (t.clientId && t.clientId !== selectedClientId) {
        selectClient(t.clientId);
        await loadTasksFor(t.clientId);
      }
      setMode("existing");
      selectedTaskId = t.id;
      taskSearchInput.value = t.title;
      notesInput.focus();
    });
    row.append(title, open, addTo);
    clippedListEl.append(row);
  }
}





