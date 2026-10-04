import assets from './assets.generated.js';
import {sessions,sourceFor,localDate,digest} from './calendar.js';
import {first,run,all} from './storage.js';
import {refreshCalendar,validSubscription,push,schedulerState,tick,dispatchScheduledTests,deleteDevice} from './service.js';
import {pushConfigurationStatus,failureCode,failureMessage} from './push-config.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
async function body(req){if(+(req.headers.get('Content-Length')||0)>8192)fail('Request too large',413);const text=await req.text();if(text.length>8192)fail('Request too large',413);try{return JSON.parse(text);}catch{fail('Invalid JSON');}}
async function authenticate(req,env){const id=req.headers.get('X-Device-Id');const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');if(!id||!token)fail('Device registration not found',401);const device=await first(env,'SELECT * FROM devices WHERE id=?',id);if(!device||device.token_hash!==await digest(token))fail('Device registration not found',401);return device;}
async function releaseTestClaim(env,id,attemptAt){await run(env,'UPDATE devices SET last_test=NULL,test_count=CASE WHEN test_count>0 THEN test_count-1 ELSE 0 END WHERE id=? AND last_test=?',id,attemptAt);}
export async function handle(req,env,ctx){
 const url=new URL(req.url),path=url.pathname;
 if(path==='/api/jobs/tick'){
  if(req.method!=='POST'||!env.JOB_TOKEN||req.headers.get('Authorization')!=='Bearer '+env.JOB_TOKEN)fail('Not authorized',401);
  return json(await tick(env,{cursor:url.searchParams.get('cursor')||'',force:!url.searchParams.get('cursor')}));
 }
 if(path==='/api/jobs/tests'){
  if(req.method!=='POST'||!env.JOB_TOKEN||req.headers.get('Authorization')!=='Bearer '+env.JOB_TOKEN)fail('Not authorized',401);
  return json(await dispatchScheduledTests(env));
 }
 if(path.startsWith('/api/')&&req.method!=='GET'){
  if(req.headers.get('Origin')!==url.origin)fail('Request origin not allowed',403);
  if(!req.headers.get('Content-Type')?.includes('application/json'))fail('JSON required',415);
 }
 if(path==='/api/config'&&req.method==='GET'){const pushConfiguration=await pushConfigurationStatus(env);return json({sessions:sessions.map(({id,label})=>({id,label})),publicKey:pushConfiguration.ready?env.VAPID_PUBLIC_KEY.trim():null,pushConfiguration,scheduler:await schedulerState(env)});}
 if(path==='/api/visit'&&req.method==='POST'){
  const b=await body(req);if(typeof b.visitor!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(b.visitor))fail('Invalid visitor');
  const now=new Date().toISOString(),day=now.slice(0,10);
  await run(env,'INSERT OR IGNORE INTO daily_visitors(day,visitor_hash,first_seen) VALUES(?,?,?)',day,await digest(day+':'+b.visitor),now);
  return json({recorded:true});
 }
 if(path==='/api/calendar'&&req.method==='GET'){
  const s=sessions.find(s=>s.id===(url.searchParams.get('session')||'regular'));if(!s)fail('Unknown academic session');
  const row=await refreshCalendar(env,s);if(!row)return json({error:'Calendar check in progress. Please try again.',source:sourceFor(s)},503);
  return json({session:s.id,label:s.label,source:sourceFor(s),events:JSON.parse(row.events),checkedAt:row.checked_at,attemptedAt:row.attempted_at,stale:!!row.error||Date.now()-Date.parse(row.checked_at)>90*60000,warning:row.error?'BMCC could not be checked. Showing the last verified calendar.':null,today:localDate()});
 }
 if(path==='/api/device'&&req.method==='POST'){
  const b=await body(req);if(!validSubscription(b.subscription))fail('Unsupported or invalid push registration');
  if(!sessions.some(s=>s.id===b.session)||![18,19,20].includes(b.hour)||typeof b.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(b.token))fail('Invalid reminder settings');
  const id=await digest(b.subscription.endpoint),tokenHash=await digest(b.token),now=new Date().toISOString();
  const old=await first(env,'SELECT token_hash FROM devices WHERE id=?',id);if(old&&old.token_hash!==tokenHash)fail('This device must unsubscribe before it can register again.',409);
  const previous=await first(env,'SELECT id,created_at,last_test,test_window_start,test_count FROM devices WHERE token_hash=? ORDER BY updated_at DESC LIMIT 1',tokenHash);
  const result=await run(env,`INSERT INTO devices(id,token_hash,subscription,session,hour,created_at,updated_at,last_test,test_window_start,test_count) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,session=excluded.session,hour=excluded.hour,updated_at=excluded.updated_at WHERE devices.token_hash=excluded.token_hash`,id,tokenHash,JSON.stringify(b.subscription),b.session,b.hour,previous?.created_at||now,now,previous?.last_test||null,previous?.test_window_start||null,previous?.test_count||0);
  if(!result.meta.changes)fail('Registration conflict',409);
  if(previous&&previous.id!==id)await deleteDevice(env,previous.id);
  return json({id,registered:true,scheduler:await schedulerState(env)});
 }
 if(path==='/api/device'&&req.method==='GET'){const device=await authenticate(req,env);return json({registered:true,session:device.session,hour:device.hour,scheduler:await schedulerState(env)});}
 if(path==='/api/device'&&req.method==='DELETE'){const device=await authenticate(req,env);await deleteDevice(env,device.id);return json({removed:true});}
 if(path==='/api/test-receipt'&&req.method==='POST'){
  const b=await body(req);
  if(typeof b.id!=='string'||typeof b.token!=='string'||b.token.length!==64||!['display_requested','display_failed'].includes(b.state))fail('Invalid receipt',400);
  const result=await run(env,'UPDATE push_tests SET received_at=?,display_state=?,worker_version=? WHERE id=? AND receipt_hash=? AND received_at IS NULL AND created_at > ?',new Date().toISOString(),b.state,String(b.workerVersion||'').slice(0,50),b.id,await digest(b.token),new Date(Date.now()-3600000).toISOString());
  if(!result.meta.changes){const scheduled=await run(env,'UPDATE scheduled_tests SET received_at=?,display_state=?,worker_version=? WHERE id=? AND receipt_hash=? AND received_at IS NULL AND dispatched_at IS NOT NULL AND due_at > ?',new Date().toISOString(),b.state,String(b.workerVersion||'').slice(0,50),b.id,await digest(b.token),new Date(Date.now()-3600000).toISOString());if(!scheduled.meta.changes)fail('Receipt unavailable',404);}
  return json({recorded:true});
 }
 if(path==='/api/test'&&req.method==='GET'){
  const device=await authenticate(req,env);
  const row=await first(env,'SELECT id,created_at,provider_status,received_at,display_state,worker_version FROM push_tests WHERE device=?',device.id);
  return json({test:row||null});
 }
 if(path==='/api/test/scheduled'&&req.method==='GET'){
  const device=await authenticate(req,env);
  const row=await first(env,'SELECT id,due_at,dispatched_at,provider_status,received_at,display_state,worker_version FROM scheduled_tests WHERE device=?',device.id);
  if(row?.display_state?.startsWith('send_failed:'))row.error=failureMessage(row.display_state.slice('send_failed:'.length),row.provider_status);
  return json({test:row||null,scheduler:await schedulerState(env)});
 }
 if(path==='/api/test/scheduled'&&req.method==='POST'){
  const device=await authenticate(req,env),scheduler=await schedulerState(env);
  if(!scheduler.testReady)fail('Scheduled testing is not connected yet. Please try after the scheduler is active.',503);
  const now=Date.now(),attemptAt=new Date(now).toISOString(),windowCutoff=new Date(now-86400000).toISOString();
  const claim=await run(env,`UPDATE devices SET last_test=?,test_window_start=CASE WHEN test_window_start IS NULL OR test_window_start<=? THEN ? ELSE test_window_start END,test_count=CASE WHEN test_window_start IS NULL OR test_window_start<=? THEN 1 ELSE test_count+1 END WHERE id=? AND (last_test IS NULL OR last_test<?) AND (test_window_start IS NULL OR test_window_start<=? OR test_count<10)`,attemptAt,windowCutoff,attemptAt,windowCutoff,device.id,new Date(now-60000).toISOString(),windowCutoff);
  if(!claim.meta.changes)fail('Please wait before scheduling another test.',429);
  const id=crypto.randomUUID(),token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),dueAt=new Date(now+3*60000).toISOString();
  try{await run(env,'INSERT INTO scheduled_tests(device,id,receipt_token,receipt_hash,due_at) VALUES(?,?,?,?,?) ON CONFLICT(device) DO UPDATE SET id=excluded.id,receipt_token=excluded.receipt_token,receipt_hash=excluded.receipt_hash,due_at=excluded.due_at,dispatched_at=NULL,provider_status=NULL,received_at=NULL,display_state=NULL,worker_version=NULL',device.id,id,token,await digest(token),dueAt);}
  catch(error){await releaseTestClaim(env,device.id,attemptAt);throw error;}
  return json({scheduled:true,id,dueAt});
 }
 if(path==='/api/test'&&req.method==='POST'){
  const device=await authenticate(req,env),now=Date.now(),attemptAt=new Date(now).toISOString(),cooldownCutoff=new Date(now-60000).toISOString(),windowCutoff=new Date(now-86400000).toISOString();
  const claim=await run(env,`UPDATE devices SET last_test=?,test_window_start=CASE WHEN test_window_start IS NULL OR test_window_start<=? THEN ? ELSE test_window_start END,test_count=CASE WHEN test_window_start IS NULL OR test_window_start<=? THEN 1 ELSE test_count+1 END WHERE id=? AND (last_test IS NULL OR last_test<?) AND (test_window_start IS NULL OR test_window_start<=? OR test_count<10)`,attemptAt,windowCutoff,attemptAt,windowCutoff,device.id,cooldownCutoff,windowCutoff);
  if(!claim.meta.changes){
   const latest=await first(env,'SELECT last_test,test_window_start,test_count FROM devices WHERE id=?',device.id),windowActive=latest?.test_window_start&&Date.parse(latest.test_window_start)>now-86400000;
   if(windowActive&&latest.test_count>=10){const retryAt=Date.parse(latest.test_window_start)+86400000;return json({error:'Daily automatic-test limit reached. You can still use “Test this device.”',dailyLimit:true,retryAfter:Math.max(1,Math.ceil((retryAt-now)/1000)),retryAt:new Date(retryAt).toISOString()},429);}
   return json({error:'Please wait before another automatic test.',retryAfter:Math.max(1,Math.ceil((Date.parse(latest?.last_test||attemptAt)+60000-now)/1000))},429);
  }
  const testId=crypto.randomUUID(),receiptToken=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  let status;try{
   await run(env,'INSERT INTO push_tests(device,id,receipt_hash,created_at) VALUES(?,?,?,?) ON CONFLICT(device) DO UPDATE SET id=excluded.id,receipt_hash=excluded.receipt_hash,created_at=excluded.created_at,provider_status=NULL,received_at=NULL,display_state=NULL,worker_version=NULL',device.id,testId,await digest(receiptToken),attemptAt);
   status=await push(env,JSON.parse(device.subscription),{title:'Campus Pause · Delivery test',body:'This notification arrived from Campus Pause. Your connection test is complete.',tag:'campus-pause-test-'+testId,testId,receiptToken,url:'/'});
   await run(env,'UPDATE push_tests SET provider_status=? WHERE device=? AND id=?',status,device.id,testId);
  }catch(error){const code=failureCode(error);console.error('delivery test failed',code);await run(env,'UPDATE push_tests SET provider_status=?,display_state=? WHERE device=? AND id=?',error.providerStatus||0,'send_failed:'+code,device.id,testId);await releaseTestClaim(env,device.id,attemptAt);fail(failureMessage(code,error.providerStatus),error.httpStatus||503);}
  if(status===404||status===410){await deleteDevice(env,device.id);fail('This browser registration expired. Enable reminders again.',410);}
  if(status<200||status>=300){await releaseTestClaim(env,device.id,attemptAt);fail('The push service did not accept this test. Please try again.',502);}
  return json({accepted:true,testId,providerStatus:status,retryAfter:60});
 }
 if(path.startsWith('/api/'))fail('Not found',404);
 if(!['GET','HEAD'].includes(req.method))fail('Method not allowed',405);
 const asset=assets[path==='/'?'/index.html':path];if(!asset)fail('Not found',404);
 return new Response(req.method==='HEAD'?null:asset.content,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',...(path==='/sw.js'?{'Service-Worker-Allowed':'/'}:{})}});
}
export async function handleSchedule(cron,env){
 if(cron==='* * * * *')return dispatchScheduledTests(env);
 if(cron==='0 * * * *'){
  let cursor='';
  for(let page=0;page<100;page++){
   const result=await tick(env,{cursor,force:!cursor});
   if(result.busy)throw Error('Hourly calendar check is already running');
   if(result.calendarsChecked!==sessions.length||result.failed)throw Error('Calendar check or reminder delivery failed');
   cursor=result.nextCursor;
   if(!cursor)return result;
  }
  throw Error('Reminder batch exceeded 100 pages');
 }
 throw Error('Unknown Cron trigger: '+cron);
}
export default {async fetch(req,env,ctx){try{return await handle(req,env,ctx);}catch(error){console.error('request failed',new URL(req.url).pathname,error.status||500);return json({error:error.status?error.message:'Service temporarily unavailable. Please try again.'},error.status||503);}},async scheduled(controller,env,ctx){ctx.waitUntil(handleSchedule(controller.cron,env));}};
