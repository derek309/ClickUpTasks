const tokenInput = document.getElementById("token");
const statusEl = document.getElementById("status");

chrome.storage.local.get("apiToken", ({ apiToken }) => {
  if (apiToken) tokenInput.value = apiToken;
});

document.getElementById("save").addEventListener("click", () => {
  const value = tokenInput.value.trim();
  if (!value.startsWith("cut_")) {
    statusEl.textContent = 'That doesn\'t look like a ClickUpTasks token (should start with "cut_").';
    statusEl.className = "err";
    return;
  }
  chrome.storage.local.set({ apiToken: value }, () => {
    statusEl.textContent = "Saved.";
    statusEl.className = "ok";
  });
});
