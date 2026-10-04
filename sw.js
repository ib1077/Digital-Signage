"use strict";
importScripts("./version.js");
const CACHE_NAME = "signage-pwa-v" + self.SIGNAGE_VERSION;
const READY = new URL("./__offline_ready__", self.registration.scope).href;
const SHELL = ["./index.html", "./app.js", "./update.js", "./version.js", "./style.css", "./terminal.js", "./terminal.css", "./fares.js", "./terminal-config.json", "./manifest.webmanifest", "./catalog.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png"];
const absolute = path => new URL(path, self.registration.scope).href;
async function prepareCache() {
  const cache = await caches.open(CACHE_NAME);
  if (await cache.match(READY)) return;
  try {
    async function add(path) {
      const url = absolute(path);
      if (!url.startsWith(self.registration.scope)) throw new Error("Out of scope asset");
      const response = await fetch(new Request(url, {cache: "no-store"}));
      if (!response.ok || response.type === "opaque" || response.redirected) throw new Error("Asset unavailable: " + path);
      await cache.put(url, response.clone());
      return response;
    }
    for (const path of SHELL) await add(path);
    const version = await (await cache.match(absolute("./version.js"))).text();
    if (!version.includes('"' + self.SIGNAGE_VERSION + '"')) throw new Error("Version changed during download");
    const catalog = await (await cache.match(absolute("./catalog.json"))).json();
    for (const item of catalog) {
      if (!item.data) continue;
      const data = await (await add(item.data)).json();
      for (const path of new Set((data.pages || data).map(p => p.image).filter(Boolean))) await add(path);
    }
    const terminal = await (await cache.match(absolute("./terminal-config.json"))).json();
    for (const path of terminal.assets || []) await add(path);
    await cache.put(READY, new Response(self.SIGNAGE_VERSION));
  } catch (error) {
    await caches.delete(CACHE_NAME); // Only this incomplete new version.
    throw error;
  }
}
self.addEventListener("install", event => event.waitUntil(prepareCache()));
// No automatic skipWaiting: running clients keep their current version.
// Retain older caches for existing tabs and failed-update recovery.
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  if (event.data?.type !== "ACTIVATE_UPDATE") return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (await cache.match(READY)) await self.skipWaiting();
  })());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const url = new URL(event.request.url);
    const isHome = url.pathname === new URL(self.registration.scope).pathname || url.pathname === new URL(absolute("./index.html")).pathname;
    const cached = event.request.mode === "navigate" && isHome
      ? await cache.match(absolute("./index.html"))
      : await cache.match(event.request);
    return cached || fetch(event.request);
  })());
});
