const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.dialog;

let repoPathEl, statusEl;

async function loadConfig() {
  const cfg = await invoke("get_config");
  repoPathEl.value = cfg.repo_path || "";
  await validate();
}

async function validate() {
  const path = repoPathEl.value.trim();
  if (!path) {
    statusEl.textContent = "";
    statusEl.className = "status";
    return;
  }
  const ok = await invoke("repo_path_looks_valid", { path });
  statusEl.textContent = ok
    ? "Looks right — found mcp/server.mjs here."
    : "Doesn't look like the clickuptasks repo (no mcp/server.mjs found) — you can still save it.";
  statusEl.className = ok ? "status ok" : "status warn";
}

async function browse() {
  const picked = await open({ directory: true, multiple: false, title: "Select the clickuptasks repo folder" });
  if (typeof picked === "string") {
    repoPathEl.value = picked;
    await validate();
  }
}

async function save() {
  await invoke("save_config", { repoPath: repoPathEl.value.trim() });
  statusEl.textContent = "Saved.";
  statusEl.className = "status ok";
}

window.addEventListener("DOMContentLoaded", () => {
  repoPathEl = document.querySelector("#repoPath");
  statusEl = document.querySelector("#status");
  document.querySelector("#browse").addEventListener("click", browse);
  document.querySelector("#save").addEventListener("click", save);
  repoPathEl.addEventListener("blur", validate);
  loadConfig();
});
