/* US VISA WITH ARGISHTI — service worker.
 * Responsibilities: (1) show push notifications while the app is closed, (2) handle notification buttons (Open / Snooze),
 * (3) keep the installed app opening instantly with a tiny offline shell.
 * It deliberately never caches API responses, client data or documents. */

const SHELL_CACHE = "uva-shell-v1";
const SHELL_ASSETS = ["/offline", "/icons/icon-192.png", "/brand/logo-320.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Navigation requests fall back to the offline page when the network is unavailable. Everything else goes straight to the network.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline")));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "US VISA WITH ARGISHTI — Reminder", body: event.data ? event.data.text() : "You have a reminder." };
  }
  const title = data.title || "US VISA WITH ARGISHTI — Reminder";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-96.png",
    tag: data.tag || "uva-reminder",
    renotify: true,
    requireInteraction: Boolean(data.requireInteraction),
    actions: data.actions || [],
    data: data.data || { url: data.url || "/dashboard" },
    timestamp: Date.now(),
  };
  event.waitUntil(
    self.registration.showNotification(title, options).then(() =>
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => wins.forEach((w) => w.postMessage({ type: "push-received" }))),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  const d = n.data || {};
  n.close();

  if (event.action === "snooze" && d.taskId && d.taskId !== "test") {
    event.waitUntil(
      fetch(`/api/tasks/${d.taskId}/snooze`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: 15 }),
      })
        .then((r) =>
          self.registration.showNotification("Snoozed for 15 minutes", {
            body: r.ok ? "I'll remind you again shortly." : "Open the app and sign in to snooze.",
            icon: "/icons/icon-192.png",
            tag: "uva-snooze-ack",
            silent: true,
          }),
        )
        .then(() => new Promise((res) => setTimeout(res, 2500)))
        .then(() => self.registration.getNotifications({ tag: "uva-snooze-ack" }))
        .then((list) => list.forEach((x) => x.close()))
        .catch(() => undefined),
    );
    return;
  }

  const url = d.url || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.postMessage({ type: "navigate", url });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// If the browser rotates the push subscription, tell any open page so it can re-register.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => wins.forEach((w) => w.postMessage({ type: "resubscribe" }))));
});
