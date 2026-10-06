// Only public application files are cached. Never cache discovery or credentials.
const CACHE='lunagpt-shell-v3';
const FILES=['./','./index.html','./style.css','./polish.css','./luna.js','./assets/logo.png','./manifest.webmanifest'];
const urls=new Set(FILES.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lunagpt-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!urls.has(event.request.url))return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));
});
