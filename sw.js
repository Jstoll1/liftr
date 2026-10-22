// Offline shell for the pick'em app. Built so it can never strand an old
// build:
//   - The page itself (/ and /index.html) is network first. A phone with
//     signal always gets the newest index.html, which names the newest
//     stamped files. Only when the network fails, or takes longer than
//     NAV_TIMEOUT_MS, is the last good copy served instead, and the network
//     answer still lands in the cache for next time.
//   - Stamped files (anything with ?v=) are cache first. A stamp names one
//     build forever, so a cached copy can never be the wrong one. Older
//     stamps of the same file are dropped as new ones arrive.
//   - version.json, the Worker and ESPN data are never touched here, so the
//     update check and live scores behave exactly as they do without this.
//   - Fonts and unstamped images on this site are served from cache and
//     refreshed in the background.
// Kill switch: replace this file with one whose install calls
// self.skipWaiting(), whose activate deletes every cache and calls
// self.registration.unregister(), and push. Phones pick it up on their
// next visit because the page registers with updateViaCache "none".
const SHELL = "brochiefs-shell-v1";
const ASSETS = "brochiefs-assets-v1";
const KEEP = new Set([SHELL, ASSETS]);
const NAV_TIMEOUT_MS = 4000;
const SHELL_KEY = "./index.html";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // Take the current page and every stamped file it names, so the very
  // first visit is enough to open with no signal.
  e.waitUntil((async () => {
    try {
      const res = await fetch(SHELL_KEY, { cache: "no-store" });
      if (!res.ok) return;
      const html = await res.clone().text();
      await (await caches.open(SHELL)).put(SHELL_KEY, res);
      const urls = [...new Set([...html.matchAll(/(?:href|src)="([^"]+\?v=\d{12})"/g)].map((m) => m[1]))]
        .filter((u) => !/^[a-z]+:/i.test(u));
      const cache = await caches.open(ASSETS);
      await Promise.all(urls.map((u) => cache.add(u).catch(() => {})));
    } catch { /* offline at install: the runtime rules fill the cache */ }
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("brochiefs-") && !KEEP.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

function isShell(url) {
  return url.origin === self.location.origin && (url.pathname === "/" || url.pathname === "/index.html");
}

async function shellResponse(e) {
  const cache = await caches.open(SHELL);
  const network = fetch(e.request.url, { cache: "no-store", credentials: "same-origin" }).then((res) => {
    // A navigation may not be answered with a redirected response.
    if (res.redirected) res = new Response(res.body, res);
    if (res.ok) e.waitUntil(cache.put(SHELL_KEY, res.clone()));
    return res;
  });
  network.catch(() => {});
  const timeout = new Promise((r) => setTimeout(r, NAV_TIMEOUT_MS, null));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    // Slow network: show the saved page now, keep the fetch for next time.
    const saved = await cache.match(SHELL_KEY);
    if (saved) { e.waitUntil(network.catch(() => {})); return saved; }
    return await network;
  } catch {
    const saved = await cache.match(SHELL_KEY);
    if (saved) return saved;
    throw new Error("offline and nothing saved");
  }
}

async function stampedResponse(e, url) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.ok) {
    e.waitUntil((async () => {
      await cache.put(e.request, res.clone());
      // One stamp per file: drop the older builds of this path.
      for (const req of await cache.keys()) {
        const u = new URL(req.url);
        if (u.pathname === url.pathname && u.search !== url.search && u.searchParams.has("v")) await cache.delete(req);
      }
    })());
  }
  return res;
}

async function staleWhileRevalidate(e, req = e.request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  const network = fetch(req).then((res) => {
    // Opaque cross origin answers are skipped: they cost a lot of quota.
    if (res.ok && res.type !== "opaque") e.waitUntil(cache.put(req, res.clone()));
    return res;
  });
  if (hit) { e.waitUntil(network.catch(() => {})); return hit; }
  return network;
}

const LOGOS = "brochiefs-logos-v1";
KEEP.add(LOGOS);
async function logoResponse(e) {
  const cache = await caches.open(LOGOS);
  const hit = await cache.match(e.request.url);
  if (hit) return hit; // logos do not change week to week
  // The plain image request, one trip; saved as is (an opaque copy still
  // paints in an <img>).
  const res = await fetch(e.request);
  if (res.ok || res.type === "opaque") e.waitUntil(cache.put(e.request.url, res.clone()).catch(() => {}));
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") {
    if (isShell(url)) e.respondWith(shellResponse(e));
    return; // other pages on the site (admin, reports) pass straight through
  }
  if (url.origin === self.location.origin) {
    if (url.pathname === "/version.json" || url.pathname === "/sw.js") return;
    if (url.searchParams.has("v")) { e.respondWith(stampedResponse(e, url)); return; }
    if (/^\/(images|icons|assets)\//.test(url.pathname) || url.pathname === "/manifest.json") e.respondWith(staleWhileRevalidate(e));
    return;
  }
  // Team logos: kept on the phone so they paint at once on the next open.
  if (url.hostname === "a.espncdn.com" && /teamlogos|combiner/.test(url.pathname + url.search)) { e.respondWith(logoResponse(e)); return; }
  // The font stylesheet is linked without crossorigin, which would make it
  // opaque; Google serves it with CORS, so ask for it that way.
  if (url.hostname === "fonts.googleapis.com") e.respondWith(staleWhileRevalidate(e, new Request(req.url, { mode: "cors", credentials: "omit" })));
  else if (url.hostname === "fonts.gstatic.com") e.respondWith(staleWhileRevalidate(e));
});
