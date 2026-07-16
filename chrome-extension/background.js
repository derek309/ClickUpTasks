// Minimal MV3 service worker — opens the settings page on first install so a
// new user is prompted to paste their personal API token right away.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

// Deliberately NOT using chrome.sidePanel.setPanelBehavior({
// openPanelOnActionClick: true }) — captureVisibleTab needs the activeTab
// grant, which is only given for a genuine top-level user gesture the
// extension system recognizes (this onClicked handler qualifies; a button
// clicked inside the side panel's own UI does not, and there's a known
// Chromium limitation where activeTab doesn't apply correctly when the side
// panel auto-opens via openPanelOnActionClick since that consumes the click
// without ever firing onClicked). So: capture first, inside this real click,
// then open the panel — never the other way around.
chrome.action.onClicked.addListener(async (tab) => {
  let screenshot = null;
  try {
    screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch {
    // e.g. a chrome:// page, or a page the extension can't capture — fail
    // soft, the panel still opens and works without a screenshot.
  }
  await chrome.storage.local.set({ pendingCapture: { screenshot, title: tab.title || "", url: tab.url || "" } });
  await chrome.sidePanel.open({ windowId: tab.windowId });
});
