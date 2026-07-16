// Minimal MV3 service worker — opens the settings page on first install so a
// new user is prompted to paste their personal API token right away.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
