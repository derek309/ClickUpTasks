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
// without ever firing onClicked).
chrome.action.onClicked.addListener((tab) => {
  // Both calls are made in this tick, before any await, because they each
  // need the click and neither can have it second-hand:
  //
  //   captureVisibleTab needs the activeTab grant, which only a genuine
  //   top-level gesture confers.
  //
  //   sidePanel.open() must be called *during* a user gesture. Awaiting the
  //   capture first spent it, and Chrome then refused to open the panel —
  //   which is why clicking the toolbar icon did nothing at all.
  //
  // The previous version awaited the capture and the storage write before
  // opening. That reads naturally and was wrong: by the time it asked for the
  // panel, the click it was responding to had already been consumed.
  const capturing = chrome.tabs
    .captureVisibleTab(tab.windowId, { format: "png" })
    // e.g. a chrome:// page, or one the extension cannot capture — fail soft,
    // the panel still opens and works without a screenshot.
    .catch(() => null);

  const opening = chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});

  // The panel reads pendingCapture when it loads, so this only has to land
  // soon, not first.
  void Promise.all([capturing, opening]).then(([screenshot]) =>
    chrome.storage.local.set({
      pendingCapture: { screenshot, title: tab.title || "", url: tab.url || "" },
    }),
  );
});
