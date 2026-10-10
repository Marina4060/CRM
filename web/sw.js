// Lets the app (app.html) and the front page (index.html) open without a connection. Only the app's own files are
// cached here; account data and the CRM itself are handled by app.js.
var VERSION = 'shell-v4';
var FILES = ['app.html', 'index.html', 'app.js', 'styles.css', 'config.js', 'manifest.webmanifest',
  'terms.html', 'privacy.html', 'legal.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('shell-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// network first, so updates show straight away; the cache is the fallback
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) {
    if (r.ok) { var copy = r.clone(); caches.open(VERSION).then(function (c) { c.put(e.request, copy); }); }
    return r;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match(/app\.html$/.test(url.pathname) ? 'app.html' : 'index.html'); });
  }));
});
