// AI社員 レベル診断 service worker v3 (2026-10-09)
// 方針: 電波があるときは必ず網から最新を取る(network-first)。取れたものを控えに残し、
// 電波がないときだけ控えを出す。旧版 v1 は控えを先に出す作りで、古い料金が居座った。
// その控え(ai-shain-v1 など)は有効化のときに消し、開いている画面を読み直させる。
var CACHE = "ai-shain-v3-20261009";
var PRECACHE = ["./", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-180.png"];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(PRECACHE.map(function (u) {
        return fetch(u, { cache: "no-cache" }).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
      }));
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      var old = keys.filter(function (k) { return k.indexOf("ai-shain") === 0 && k !== CACHE; });
      return Promise.all(old.map(function (k) { return caches.delete(k); })).then(function () { return old.length; });
    }).then(function (removed) {
      return self.clients.claim().then(function () {
        if (!removed) return;
        return self.clients.matchAll({ type: "window" }).then(function (cs) {
          cs.forEach(function (c) { try { c.navigate(c.url); } catch (x) {} });
        });
      });
    })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var scope = new URL("./", self.location).pathname;
  if (url.pathname.indexOf(scope) !== 0) return;
  if (url.pathname === scope + "sw.js") return;
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then(function (res) {
      if (res && res.ok) {
        var key = (req.mode === "navigate") ? "./" : req;
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(key, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode !== "navigate") return Response.error();
        return caches.match("./").then(function (home) { return home || Response.error(); });
      });
    })
  );
});
