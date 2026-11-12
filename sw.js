/* Mon Planning — service worker : l'app marche sans réseau, et propose les mises à jour */
const VERSION = "mp-2026-11-13-1";
const FICHIERS = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png",
  "./icon-512.png", "./favicon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS))); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== VERSION).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "maj") self.skipWaiting(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, {ignoreSearch: true}).then(r => r || fetch(e.request).then(rep => {
    if (rep.ok && (e.request.url.startsWith(self.location.origin) || e.request.url.includes("fonts.g"))) {
      const copie = rep.clone(); caches.open(VERSION).then(c => c.put(e.request, copie));
    }
    return rep;
  }).catch(() => caches.match("./index.html"))));
});
