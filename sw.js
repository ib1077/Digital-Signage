const CACHE_PREFIX = "signage-pwa-";
const CACHE_NAME = CACHE_PREFIX + "v1";
const SHELL = ["./", "./index.html", "./app.js", "./style.css", "./manifest.webmanifest", "./catalog.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png"];
self.addEventListener("install", event => {
 event.waitUntil((async () => {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(SHELL);
  const catalog = await (await cache.match("./catalog.json")).json();
  for (const item of catalog) {
   if (!item.data) continue;
   await cache.add(item.data);
   const data = await (await cache.match(item.data)).json();
   await cache.addAll([...new Set((data.pages || data).map(p => p.image).filter(Boolean))]);
  }
  await self.skipWaiting();
 })());
});
self.addEventListener("activate", event => {
 event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)));
  await self.clients.claim();
 })());
});
self.addEventListener("fetch", event => {
 if (event.request.method !== "GET" || !event.request.url.startsWith(self.registration.scope)) return;
 event.respondWith((async () => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  try { return await fetch(event.request); }
  catch (error) {
   if (event.request.mode === "navigate") return (await cache.match("./index.html")) || Response.error();
   return Response.error();
  }
 })());
});
