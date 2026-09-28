const CACHE='isp-control-pwa-v1';
const CORE=['./index.html','./manifest.webmanifest'];
const ICON='https://varccsjoydhlfazaizqs.supabase.co/functions/v1/isp-control-assets/icon.png';

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.allSettled([...CORE,ICON].map(url=>cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(req,{cache:'no-store'});
        const cache=await caches.open(CACHE);
        cache.put('./index.html',fresh.clone()).catch(()=>{});
        return fresh;
      }catch{
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  if(url.origin===self.location.origin && (url.pathname.endsWith('/manifest.webmanifest') || url.pathname.endsWith('/index.html'))){
    event.respondWith((async()=>{
      const cached=await caches.match(req);
      if(cached)return cached;
      const fresh=await fetch(req);
      const cache=await caches.open(CACHE);
      cache.put(req,fresh.clone()).catch(()=>{});
      return fresh;
    })());
  }
});
