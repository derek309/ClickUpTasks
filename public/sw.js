// ClickUpTasks service worker: phone notifications only (Derek, 2026-10-15).
// It caches nothing and has no fetch handler, so every open loads the newest
// deploy straight from the network, exactly as a browser tab does.
// The payload is lib/pushPayload.ts PushPayload: { title, body, url, tag?, badgeCount? }.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { body: event.data ? event.data.text() : "" }; }
  const url = typeof p.url === "string" && p.url.startsWith("/") && !p.url.startsWith("//") ? p.url : "/";
  const options = {
    body: p.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url },
  };
  if (p.tag) { options.tag = p.tag; options.renotify = true; }
  const shown = self.registration.showNotification(p.title || "ClickUpTasks", options);
  const badge = typeof p.badgeCount === "number" && self.navigator && "setAppBadge" in self.navigator
    ? (p.badgeCount > 0 ? self.navigator.setAppBadge(p.badgeCount) : self.navigator.clearAppBadge()).catch(() => {})
    : Promise.resolve();
  event.waitUntil(Promise.all([shown, badge]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const mine = open.filter((c) => new URL(c.url).origin === self.location.origin);
    const win = mine.find((c) => c.focused) || mine[0];
    if (win) {
      try {
        const focused = await win.focus();
        await (focused || win).navigate(target);
        return;
      } catch { /* fall through and open one */ }
    }
    await self.clients.openWindow(target);
  })());
});
