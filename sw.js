// ===== Service Worker：应用壳缓存 + 离线降级 =====
// 策略：
//  - 数据接口（/api/、/data/）永远走网络、绝不缓存（保证数据实时、不被旧缓存污染）
//  - 页面导航（/index.html）network-first，离线时降级到缓存壳
//  - 静态资源（css/js/图标）stale-while-revalidate（先给缓存、后台更新）
// 版本号：改前端资源记得同步升 CACHE 版本，否则用户一直拿旧壳
// 流程：每次对 css/js/html 做了用户可见的改动 → 升这个 → 升 index.html 里的 ?v= → app.js 也升级触发 reg.update()
const CACHE = 'mcb-shell-v15';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 数据请求：永远走网络，不缓存（避免缓存旧数据导致"装好但数据不对"）
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) {
    event.respondWith(fetch(req));
    return;
  }

  // 页面导航：network-first（保证 index.html 及时更新），离线降级缓存
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cached = await caches.match(req) || await caches.match('/index.html');
        return cached || new Response('离线且无本地缓存', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 静态资源：stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
