/*
 * Zaki Workspace's service worker. One job: show a ring (or a missed call) that arrives while the site is closed,
 * and open the call on a tap (src/server/calls/push.ts sends them). No fetch handler and no cache: the site works
 * exactly as without it. The words come from the server, already in Arabic.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  if (!data || !data.title || !data.url) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // the open app rings by itself (its own card and tone): no second ring on top of it
      if (data.kind === "ring" && windows.some((w) => w.visibilityState === "visible")) return;
      await self.registration.showNotification(data.title, {
        body: data.body || "",
        tag: data.tag || data.url,
        renotify: true,
        requireInteraction: data.kind === "ring",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        vibrate: data.kind === "ring" ? [400, 200, 400, 200, 400, 200, 400] : [200],
        dir: "rtl",
        lang: "ar",
        data: { url: data.url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
