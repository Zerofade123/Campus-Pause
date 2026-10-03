export const WORKER_VERSION='declarative-push-2';

export async function prepareNotificationWorker(){
 const registration=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
 await registration.update();
 const deadline=Date.now()+12000;
 while(Date.now()<deadline){
  const active=registration.active;
  if(active&&await workerVersion(active)===WORKER_VERSION)return registration;
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 throw Error('The notification update is not ready. Close and reopen the app, then try again.');
}

function workerVersion(worker){
 return new Promise(resolve=>{
  const channel=new MessageChannel();
  const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};
  const timer=setTimeout(()=>finish(null),600);
  channel.port1.onmessage=event=>finish(event.data?.version);
  try{worker.postMessage({type:'NOTIFICATION_VERSION'},[channel.port2]);}catch{finish(null);}
 });
}
