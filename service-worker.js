const CACHE="my-vocab-v5-2-offline-1";
const OFFLINE_CACHE="my-vocab-offline-v5-2";
const CORE=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./cloud-sync.js","./config.js","./service-worker.js"];
const FSRS_URL="https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.1/+esm";
self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const c=await caches.open(CACHE);
    await c.addAll(CORE);
    // Best-effort: the explicit "offline prepare" button retries this later.
    try{ await c.add(new Request(FSRS_URL,{mode:"cors"})); }catch(e){ console.warn("FSRS precache skipped",e); }
    await self.skipWaiting();
  })());
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Important configuration/code files:
  // online → always get latest version
  // offline → fall back to cache
  if (
    url.pathname.endsWith("/config.js") ||
    url.pathname.endsWith("/cloud-sync.js") ||
    url.pathname.endsWith("/index.html")
  ) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => {
            cache.put(event.request, copy);
          });
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 以下は既存処理
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.hostname==="freedictionaryapi.com"){
    event.respondWith(fetch(event.request).then(r=>{
      const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r;
    }).catch(()=>caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(r=>{
    if(url.origin===self.location.origin || url.hostname==="cdn.jsdelivr.net"){
      const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));
    }
    return r;
  })));
});
