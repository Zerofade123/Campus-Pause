import { buildPushPayload } from '@block65/webcrypto-web-push';
import {sessions,sourceFor,parseCalendar,localDate,localParts,addDays,dayEvents,digest,notificationFor} from './calendar.js';
import {first,run,all,db} from './storage.js';
const HOUR=3600000;
export async function refreshCalendar(env,s,force=false){
 const now=new Date().toISOString();let old=await first(env,'SELECT * FROM calendars WHERE id=?',s.id);
 if(!force&&old&&Date.now()-Date.parse(old.attempted_at)<(old.error?300000:HOUR))return old;
 const lease=await run(env,`INSERT INTO jobs(id,lease_until) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE jobs.lease_until IS NULL OR jobs.lease_until < ?`,'calendar:'+s.id,new Date(Date.now()+45000).toISOString(),now);
 if(!lease.meta.changes)return old;
 try{
  const response=await fetch(sourceFor(s),{headers:{Accept:'text/html','User-Agent':'CampusPause/1.0 (BMCC calendar reminders)'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('Source HTTP '+response.status);const html=await response.text();if(html.length>2500000)throw Error('Source exceeds size limit');
  const events=parseCalendar(html,s);
  // Do not silently accept wholesale removal of calendar exceptions.
  if(old&&JSON.parse(old.events).length>4&&events.length<JSON.parse(old.events).length/2)throw Error('Calendar changed substantially; review required');
  await run(env,'INSERT INTO calendars(id,events,checked_at,attempted_at,error) VALUES(?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET events=excluded.events,checked_at=excluded.checked_at,attempted_at=excluded.attempted_at,error=NULL',s.id,JSON.stringify(events),now,now);
 }catch(error){
  if(old)await run(env,'UPDATE calendars SET attempted_at=?,error=? WHERE id=?',now,String(error.message).slice(0,200),s.id);
  else throw error;
 }finally{await run(env,'UPDATE jobs SET lease_until=NULL WHERE id=?','calendar:'+s.id);}
 return first(env,'SELECT * FROM calendars WHERE id=?',s.id);
}
export function validSubscription(sub){
 try{const u=new URL(sub.endpoint);const host=u.hostname;const allowed=host==='fcm.googleapis.com'||host==='web.push.apple.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.notify.windows.com');if(!allowed||u.protocol!=='https:'||u.port||u.username||u.password||sub.endpoint.length>2048) return false;
 const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));return typeof sub.keys?.p256dh==='string'&&typeof sub.keys?.auth==='string'&&decode(sub.keys.p256dh).length===65&&decode(sub.keys.auth).length===16;
 }catch{return false;}
}
export async function push(env,subscription,data){
 let payload;
 const origin=env.APP_ORIGIN||'https://campus-pause-bmcc.gaoussou-keita441104.chatgpt.site';
 let navigate=new URL(data.url||'/',origin);
 if(navigate.origin!==new URL(origin).origin)navigate=new URL('/',origin);
 // Apple can display this standardized payload without starting JavaScript.
 // Older browsers pass the same JSON to the service worker below.
 const message={
  web_push:8030,
  notification:{title:data.title||'Campus Pause',body:data.body||'',navigate:navigate.href,tag:data.tag||'campus-pause',silent:false},
  ...(data.testId&&data.receiptToken?{testId:data.testId,receiptToken:data.receiptToken}:{})
 };
 try{payload=await buildPushPayload({data:JSON.stringify(message),options:{ttl:data.testId?60:3600,urgency:data.testId?'high':'normal'}},subscription,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});}
 catch(error){console.error('push payload build failed',error?.name||'Error');throw error;}
 // Cloudflare computes Content-Length from the typed-array body. The push
 // library includes it for generic fetch clients, but manually supplying it
 // can be ignored or rejected by edge runtimes.
 const headers={...payload.headers};delete headers['content-length'];
 try{
  const r=await fetch(subscription.endpoint,{...payload,headers,redirect:'manual',signal:AbortSignal.timeout(10000)});
  const provider=new URL(subscription.endpoint).hostname;
  const responseType=r.headers.get('content-type')||'';
  console.info('push provider response',JSON.stringify({provider,status:r.status,redirected:r.redirected,responseType}));
  // A redirected login page/HTML 200 is not a Web Push acceptance. Apple
  // documents 201 for success. Keep credentials at the original endpoint.
  if(r.redirected||(r.status>=300&&r.status<400)||responseType.includes('text/html')||(provider==='web.push.apple.com'&&r.status>=200&&r.status<300&&r.status!==201)){
   throw Error('Unexpected push provider response');
  }
  return r.status;
 }catch(error){console.error('push request failed',error?.name||'Error');throw error;}
}
export async function schedulerState(env){const job=await first(env,'SELECT * FROM jobs WHERE id=?','tick');const testJob=await first(env,'SELECT last_success FROM jobs WHERE id=?','test-dispatch');const pushReady=!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT);return {configured:env.SCHEDULER_ENABLED==='true'&&pushReady,healthy:env.SCHEDULER_ENABLED==='true'&&pushReady&&!!job?.last_success&&Date.now()-Date.parse(job.last_success)<90*60000,lastRun:job?.last_success||null,testReady:pushReady&&!!testJob?.last_success&&Date.now()-Date.parse(testJob.last_success)<3*60000};}
export async function dispatchScheduledTests(env){
 const now=new Date().toISOString();let accepted=0,failed=0;
 const tests=await all(env,'SELECT * FROM scheduled_tests WHERE due_at <= ? AND dispatched_at IS NULL ORDER BY due_at LIMIT 20',now);
 for(const test of tests){
  const claimed=await run(env,'UPDATE scheduled_tests SET dispatched_at=? WHERE device=? AND id=? AND dispatched_at IS NULL',now,test.device,test.id);
  if(!claimed.meta.changes)continue;
  const device=await first(env,'SELECT subscription FROM devices WHERE id=?',test.device);
  if(!device)continue;
  try{
   const status=await push(env,JSON.parse(device.subscription),{title:'Campus Pause · Scheduled test',body:'Your closed-app notification test arrived. This is only a test.',tag:'campus-pause-scheduled-'+test.id,testId:test.id,receiptToken:test.receipt_token,url:'/'});
   await run(env,'UPDATE scheduled_tests SET provider_status=? WHERE device=? AND id=?',status,test.device,test.id);
   if(status===404||status===410){await deleteDevice(env,test.device);failed++;}
   else if(status>=200&&status<300)accepted++;
   else failed++;
  }catch(error){console.error('scheduled push failed',error?.name||'Error');await run(env,"UPDATE scheduled_tests SET provider_status=0,display_state='send_failed' WHERE device=? AND id=?",test.device,test.id);failed++;}
 }
 await run(env,"INSERT INTO jobs(id,last_started,last_success,error) VALUES('test-dispatch',?,?,NULL) ON CONFLICT(id) DO UPDATE SET last_started=excluded.last_started,last_success=excluded.last_success,error=NULL",now,new Date().toISOString());
 return {processed:tests.length,accepted,failed};
}
export async function tick(env,{cursor='',force=false}={}){
 const started=new Date().toISOString();
 const acquired=await run(env,`INSERT INTO jobs(id,last_started,lease_until) VALUES('tick',?,?) ON CONFLICT(id) DO UPDATE SET last_started=excluded.last_started,lease_until=excluded.lease_until WHERE jobs.lease_until IS NULL OR jobs.lease_until < ?`,started,new Date(Date.now()+180000).toISOString(),started);
 if(!acquired.meta.changes)return {busy:true};
 try{
  const calendars={};for(const session of sessions){try{const row=await refreshCalendar(env,session,force);if(row&&!row.error&&Date.now()-Date.parse(row.checked_at)<75*60000)calendars[session.id]=JSON.parse(row.events);}catch{/* Keep this session ineligible for sending. */}}
  const devices=await all(env,'SELECT * FROM devices WHERE id > ? ORDER BY id LIMIT 21',cursor);const more=devices.length>20;const batch=devices.slice(0,20);let sent=0,failed=0,removed=0;
  if(env.SCHEDULER_ENABLED==='true')for(const device of batch){
   if(!calendars[device.session])continue;const now=new Date();const hour=+localParts(now).hour;const today=localDate(now);const tomorrow=addDays(today,1);
   // Corrections also cover a previously announced event on its actual day.
   for(const day of [today,tomorrow]){
    const relevant=dayEvents(calendars[device.session],day);const revision=await digest(JSON.stringify(relevant));const prior=await first(env,"SELECT * FROM deliveries WHERE device=? AND event_date=? AND state='sent' ORDER BY updated_at DESC LIMIT 1",device.id,day);
    const correction=!!prior&&prior.revision!==revision;
    const due=day===tomorrow&&hour>=device.hour&&relevant.length>0;
    if(!correction&&!due)continue;if(prior?.revision===revision)continue;
    const id=await digest(`${device.id}:${day}:${revision}`);const attemptTime=new Date().toISOString();
    const reserved=await run(env,`INSERT INTO deliveries(id,device,event_date,revision,state,updated_at,attempts) VALUES(?,?,?,?,'sending',?,1) ON CONFLICT(id) DO UPDATE SET state='sending',updated_at=excluded.updated_at,attempts=deliveries.attempts+1 WHERE deliveries.state='failed' AND deliveries.attempts<3 AND deliveries.updated_at < ?`,id,device.id,day,revision,attemptTime,new Date(Date.now()-300000).toISOString());
    if(!reserved.meta.changes)continue;
    try{const status=await push(env,JSON.parse(device.subscription),{...notificationFor(relevant,day,correction),session:device.session});
     if(status===404||status===410){await deleteDevice(env,device.id);removed++;break;}
     if(status<200||status>=300)throw Error('Push service rejected delivery');
     await run(env,"UPDATE deliveries SET state='sent',updated_at=? WHERE id=?",new Date().toISOString(),id);sent++;
    }catch{failed++;await run(env,"UPDATE deliveries SET state='failed',updated_at=? WHERE id=?",new Date().toISOString(),id);}
   }
  }
  await run(env,"DELETE FROM deliveries WHERE event_date < ?",addDays(localDate(),-35));
  await run(env,"DELETE FROM daily_visitors WHERE day < ?",addDays(localDate(),-45));
  const allFresh=Object.keys(calendars).length===sessions.length;
  await run(env,"UPDATE jobs SET last_success=?,error=?,lease_until=NULL WHERE id='tick'",allFresh?new Date().toISOString():null,allFresh?null:'One or more calendars could not be checked');
  return {sent,failed,removed,calendarsChecked:Object.keys(calendars).length,nextCursor:more?batch.at(-1).id:null,deliveryEnabled:env.SCHEDULER_ENABLED==='true'};
 }catch(error){await run(env,"UPDATE jobs SET error=?,lease_until=NULL WHERE id='tick'",String(error.message).slice(0,200));throw error;}
}
export async function deleteDevice(env,id){await db(env).batch([db(env).prepare('DELETE FROM push_tests WHERE device=?').bind(id),db(env).prepare('DELETE FROM scheduled_tests WHERE device=?').bind(id),db(env).prepare('DELETE FROM deliveries WHERE device=?').bind(id),db(env).prepare('DELETE FROM devices WHERE id=?').bind(id)]);}
