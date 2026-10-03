const CACHE='isp-control-pwa-v5';
const CORE=['./index.html','./manifest.json'];
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

  if(url.origin===self.location.origin && (url.pathname.endsWith('/manifest.json') || url.pathname.endsWith('/index.html'))){
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

self.addEventListener('push',event=>{
  let data={};
  try{ data=event.data?.json()||{}; }
  catch{ data={title:'ISP Control',body:event.data?.text()||'تحديث جديد في حالة الشبكة'}; }

  const title=data.title||'ISP Control';
  const options={
    body:data.body||'تحديث جديد في حالة الشبكة',
    icon:data.icon||ICON,
    badge:data.badge||ICON,
    tag:data.tag||'isp-router-status',
    renotify:true,
    requireInteraction:false,
    data:{
      url:data.url||'./index.html?pwa=1&section=alerts',
      ...(data.data||{})
    }
  };

  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification?.data?.url||'./index.html?pwa=1&section=alerts',self.location.href).href;
  event.waitUntil((async()=>{
    const all=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of all){
      if('focus' in client){
        try{
          if('navigate' in client) await client.navigate(target);
        }catch{}
        return client.focus();
      }
    }
    if(clients.openWindow)return clients.openWindow(target);
  })());
});
