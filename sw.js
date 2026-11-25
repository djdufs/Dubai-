/* 두바이 출장 가이드 — service worker (shell only) */
const CACHE = 'dubai-shell-v3';
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
  './assets/audio/phrase-01.mp3', './assets/audio/phrase-02.mp3', './assets/audio/phrase-03.mp3',
  './assets/audio/phrase-04.mp3', './assets/audio/phrase-05.mp3', './assets/audio/phrase-06.mp3',
  './assets/audio/phrase-07.mp3', './assets/audio/phrase-08.mp3', './assets/audio/phrase-09.mp3',
  './assets/audio/phrase-10.mp3'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // 외부 API·타일·Supabase는 그대로
  if (!/\.(html|json|png|svg|ico|webmanifest|mp3)$/.test(url.pathname) && url.pathname !== '/' && !url.pathname.endsWith('/')) return;

  // network-first: 항상 최신 화면, 오프라인이면 캐시
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
