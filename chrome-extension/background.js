// Minimal MV3 service worker — opens the settings page on first install so a
// new user is prompted to paste their personal API token right away, and
// makes the toolbar icon open the side panel (not a popup) on click.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error(err));
