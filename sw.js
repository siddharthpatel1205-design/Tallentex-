/* Tallentex service worker — makes the site installable (PWA) and gives an
   offline fallback. Strategy: network-first for same-origin GET requests so
   students always get the latest code; cache is only used if offline.
   Supabase / CDN / API calls are never touched. */
const CACHE = "tallentex-v1";
const PRECACHE = ["./", "index.html", "login.html", "signup.html", "dashboard.html",
  "css/style.css", "css/auth.css", "css/dashboard.css", "favicon.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // CDN, Supabase, fonts: browser handles
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined)))
  );
});
