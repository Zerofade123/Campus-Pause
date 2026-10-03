const WORKER_VERSION='declarative-push-2';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 if(event.data?.type==='NOTIFICATION_VERSION')event.ports?.[0]?.postMessage({version:WORKER_VERSION});
});
self.addEventListener('push',event=>{
 let data={title:'Campus Pause',body:'Open the app to check your BMCC calendar.'};
 try{data=event.data?.json()||data;}catch{}
 const notification=data.web_push===8030&&data.notification?data.notification:data;
 // Display first. A receipt confirms the API resolved, not that a banner was seen.
 const display=self.registration.showNotification(notification.title||'Campus Pause',{
  body:notification.body||'',tag:notification.tag||'campus-pause',silent:notification.silent===true,
  data:{url:safeURL(notification.navigate||notification.url)}
 });
 event.waitUntil(display.then(()=>receipt(data,'display_requested'),()=>receipt(data,'display_failed')));
});
function safeURL(value){
 try{const url=new URL(value||'/',self.location.origin);return url.origin===self.location.origin?url.href:self.location.origin+'/';}catch{return self.location.origin+'/';}
}
async function receipt(data,state){
 if(!data.testId||!data.receiptToken)return;
 try{await fetch('/api/test-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:data.testId,token:data.receiptToken,state,workerVersion:WORKER_VERSION})});}catch{}
}
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
  const existing=windows.find(w=>new URL(w.url).origin===self.location.origin);
  return existing?existing.focus():self.clients.openWindow(safeURL(event.notification.data?.url));
 }));
});
