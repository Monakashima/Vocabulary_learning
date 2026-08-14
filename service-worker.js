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
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE && k!==OFFLINE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
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
