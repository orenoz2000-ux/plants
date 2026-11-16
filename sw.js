// Keeps the app working with no connection. The page itself is asked from the network
// first (so a new build shows up), everything else is served from what was kept.
const CACHE = "plants-v1";
const BOX = "plants-remind"; // what the page writes for the reminders (src/remind.ts): never cleared here

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./manifest.webmanifest", "./icon-192.png"])));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== BOX).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const keep = (res) => {
    if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
    return res;
  };
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then((r) => r || caches.match("./"))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(keep)));
});

// ---- reminders (src/remind.ts) ----
// The phone wakes the installed app now and then (periodic background sync; it picks the moment).
// When a plant is due today or late, one notification says which; at most one a day, and never
// at night (a check at night waits for the next one).

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "plants-due") e.waitUntil(remind());
});

const dayStart = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

async function remind(now = Date.now()) {
  const box = await caches.open(BOX);
  const res = await box.match("./remind.json");
  if (!res) return;
  const { plants } = await res.json();
  const hour = new Date(now).getHours();
  if (hour < 7 || hour >= 22) return;
  const due = plants.filter((p) => p.on && p.due != null && dayStart(p.due) <= dayStart(now));
  if (!due.length) return;
  const today = new Date(now).toDateString();
  const shown = await box.match("./shown");
  if (shown && (await shown.text()) === today) return;
  // one line for each thing to do: "להשקות: בונסאי, סחלב"
  const lines = [];
  for (const todo of [...new Set(due.map((p) => p.todo))]) {
    lines.push(todo + ": " + due.filter((p) => p.todo === todo).map((p) => p.nick).join(", "));
  }
  const title = due.length === 1 ? due[0].nick + " מחכה לך" : "הצמחים מחכים לך";
  await self.registration.showNotification(title, {
    body: lines.join("\n"),
    tag: "plants-due",
    icon: "icon-192.png",
    badge: "icon-192.png",
    lang: "he",
    dir: "rtl",
    data: { open: due[0].id },
  });
  await box.put("./shown", new Response(today));
}

// a tap opens the app on the first plant that is due (or brings it forward if it is open)
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL("./?open=" + encodeURIComponent(e.notification.data?.open ?? ""), self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("navigate" in c) return c.navigate(url).then((w) => w && w.focus());
      return self.clients.openWindow(url);
    }),
  );
});

