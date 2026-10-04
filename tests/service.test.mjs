import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createECDH,randomBytes,hkdfSync,createDecipheriv} from 'node:crypto';
import {sessions,parseCalendar,dateRange,localDate,localParts,dayEvents,digest} from '../server/calendar.js';
import {tick,refreshCalendar,validSubscription,push,dispatchScheduledTests} from '../server/service.js';
import {readPushConfiguration} from '../server/push-config.js';
import worker from '../server/index.js';
function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const f of fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')))sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8'));
 const prepare=sql=>({bind(...args){const statement=sqlite.prepare(sql);return {first:async()=>statement.get(...args)||null,all:async()=>({results:statement.all(...args)}),run:async()=>({meta:{changes:Number(statement.run(...args).changes)}})};}});
 return {prepare,batch:async queries=>{sqlite.exec('BEGIN');try{const result=[];for(const q of queries)result.push(await q.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}},sqlite};
}
async function credentials(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const j=await crypto.subtle.exportKey('jwk',pair.privateKey);const raw=await crypto.subtle.exportKey('raw',pair.publicKey);return{VAPID_PUBLIC_KEY:Buffer.from(raw).toString('base64url'),VAPID_PRIVATE_KEY:j.d,VAPID_SUBJECT:'https://example.org',JOB_TOKEN:'test-only-token',SCHEDULER_ENABLED:'false'};}
async function subscription(){const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);return{endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url'),auth:Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')}};}
const request=(path,method='GET',body,extra={})=>new Request('https://example.org'+path,{method,headers:{Origin:'https://example.org','Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});
test('push setup validates matching keys and contact without exposing saved values',async()=>{
 const env={...await credentials(),DB:database()},other=await credentials();
 assert.equal((await readPushConfiguration({...env,VAPID_SUBJECT:' mailto:owner@example.org '})).subject,'mailto:owner@example.org');
 for(const [change,code] of [[{VAPID_SUBJECT:'owner@example.org'},'VAPID_SUBJECT'],[{VAPID_PRIVATE_KEY:'VAPID_PRIVATE_KEY: wrong'},'VAPID_PRIVATE_KEY'],[{VAPID_PRIVATE_KEY:other.VAPID_PRIVATE_KEY},'VAPID_KEY_PAIR']]){
  const config=await (await worker.fetch(request('/api/config'),{...env,...change},{})).json();
  assert.deepEqual(config.pushConfiguration,{ready:false,code});assert.equal(config.publicKey,null);
  assert.ok(!JSON.stringify(config).includes(env.VAPID_PRIVATE_KEY));
  await assert.rejects(readPushConfiguration({...env,...change}),error=>error.pushCode===code);
 }
});
test('provider rejection preserves a safe failure code for immediate and scheduled tests',async()=>{
 const env={...await credentials(),DB:database()},sub=await subscription(),token=randomBytes(32).toString('base64url');
 const {id}=await (await worker.fetch(request('/api/device','POST',{subscription:sub,token,session:'regular',hour:19}),env,{})).json();
 const auth={'X-Device-Id':id,Authorization:'Bearer '+token},original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({reason:'BadJwtToken'},{status:403});
 try{
  const result=await worker.fetch(request('/api/test','POST',{},auth),env,{}),body=await result.json();
  assert.equal(result.status,502);assert.match(body.error,/PUSH_AUTH \(HTTP 403\)/);assert.ok(!body.error.includes(env.VAPID_PRIVATE_KEY));
  assert.equal(env.DB.sqlite.prepare('SELECT provider_status FROM push_tests').get().provider_status,403);
  assert.equal(env.DB.sqlite.prepare('SELECT test_count FROM devices').get().test_count,0);
  env.DB.sqlite.prepare('INSERT INTO scheduled_tests(device,id,receipt_token,receipt_hash,due_at) VALUES(?,?,?,?,?)').run(id,'test','receipt','hash',new Date(Date.now()-1000).toISOString());
  assert.equal((await dispatchScheduledTests(env)).failed,1);
  const scheduled=await (await worker.fetch(request('/api/test/scheduled','GET',null,auth),env,{})).json();
  assert.equal(scheduled.test.provider_status,403);assert.match(scheduled.test.error,/PUSH_AUTH/);assert.ok(!('receipt_token' in scheduled.test));
 }finally{globalThis.fetch=original;}
});
test('date ranges, cross-year rollover, and invalid format rejection',()=>{assert.deepEqual(dateRange('December 31',sessions[3]),{date:'2026-12-31',end:'2026-12-31'});assert.equal(dateRange('January 1',sessions[0]).date,'2027-01-01');assert.equal(dateRange('September 11 –13',sessions[0]).end,'2026-09-13');assert.throws(()=>dateRange('February 30',sessions[4]));assert.throws(()=>dateRange('TBD',sessions[0]));});
test('New York time and DST are independent of UTC server time',()=>{assert.equal(localDate(new Date('2026-09-27T01:00Z')),'2026-09-26');assert.equal(localParts(new Date('2026-10-12T23:00Z')).hour,'19');assert.equal(localParts(new Date('2026-11-26T00:00Z')).hour,'19');});
test('source parsing rejects errors and preserves no-class/open-office distinction',()=>{assert.throws(()=>parseCalendar('<h1>Error</h1>',sessions[0]));const html='<h1>Fall Regular 2026</h1><table class="tablepress">'+Array.from({length:5},()=>'<tr><td>October 12</td><td>Monday</td><td>No classes - offices open</td></tr>').join('')+'</table>';assert.equal(parseCalendar(html,sessions[0])[0].type,'no-class');});
test('all five captured BMCC calendars parse when fixtures are present',()=>{for(const s of sessions){const f='fixtures/'+s.slug+'.html';if(fs.existsSync(f)){const events=parseCalendar(fs.readFileSync(f,'utf8'),s);assert.ok(events.length>=3);assert.ok(events.every(e=>e.end>=e.date));}}});
test('only approved HTTPS push providers are accepted',async()=>{const s=await subscription();assert.equal(validSubscription(s),true);assert.equal(validSubscription({...s,endpoint:'https://localhost/internal'}),false);assert.equal(validSubscription({...s,endpoint:'https://fcm.googleapis.com.attacker.test/x'}),false);assert.equal(validSubscription({...s,endpoint:'http://fcm.googleapis.com/x'}),false);});
test('push rejects redirects and HTML 200 responses; Apple acceptance requires 201',async()=>{const vapid=await credentials(),s=await subscription();s.endpoint='https://web.push.apple.com/test';const original=globalThis.fetch;try{
 for(const response of [new Response(null,{status:302,headers:{Location:'https://example.org/'}}),new Response('<html>login</html>',{status:200,headers:{'Content-Type':'text/html'}}),new Response(null,{status:200})]){
  globalThis.fetch=async()=>response;await assert.rejects(push(vapid,s,{title:'test'}));
 }
 globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.headers['content-length'],undefined);return new Response(null,{status:201});};
 assert.equal(await push(vapid,s,{title:'test'}),201);
 }finally{globalThis.fetch=original;}});
test('HTML-labelled 201 acceptance succeeds for immediate and scheduled desktop pushes',async()=>{
 const env={...await credentials(),DB:database()},sub=await subscription(),token=randomBytes(32).toString('base64url');
 const {id}=await (await worker.fetch(request('/api/device','POST',{subscription:sub,token,session:'regular',hour:19}),env,{})).json();
 const auth={'X-Device-Id':id,Authorization:'Bearer '+token},original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:201,headers:{'Content-Type':'text/html; charset=UTF-8'}});
 try{
  const response=await worker.fetch(request('/api/test','POST',{},auth),env,{}),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.accepted,true);assert.equal(body.providerStatus,201);
  const saved=env.DB.sqlite.prepare('SELECT * FROM push_tests').get();assert.equal(saved.display_state,null);assert.equal(saved.received_at,null);
  env.DB.sqlite.prepare('INSERT INTO scheduled_tests(device,id,receipt_token,receipt_hash,due_at) VALUES(?,?,?,?,?)').run(id,'test','receipt','hash',new Date(Date.now()-1000).toISOString());
  const dispatched=await dispatchScheduledTests(env);assert.equal(dispatched.accepted,1);assert.equal(dispatched.failed,0);
  const result=await (await worker.fetch(request('/api/test/scheduled','GET',null,auth),env,{})).json();
  assert.equal(result.test.provider_status,201);assert.equal(result.test.received_at,null);assert.equal(result.test.error,undefined);
 }finally{globalThis.fetch=original;}
});
test('expired Chrome push endpoints are removed even when their error body is HTML',async()=>{
 const env={...await credentials(),DB:database()},sub=await subscription(),token=randomBytes(32).toString('base64url');
 const {id}=await (await worker.fetch(request('/api/device','POST',{subscription:sub,token,session:'regular',hour:19}),env,{})).json();
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('<html>Not Found</html>',{status:404,headers:{'Content-Type':'text/html'}});
 try{const response=await worker.fetch(request('/api/test','POST',{}, {'X-Device-Id':id,Authorization:'Bearer '+token}),env,{});assert.equal(response.status,410);assert.match((await response.json()).error,/expired/);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM devices').get().n,0);}
 finally{globalThis.fetch=original;}
});
test('device registration, ownership, server test, rate limit and deletion',async()=>{const env={...await credentials(),DB:database()};const sub=await subscription(),token=Buffer.alloc(32,1).toString('base64url');let r=await worker.fetch(request('/api/device','POST',{subscription:sub,token,session:'regular',hour:19}),env,{});assert.equal(r.status,200);const {id}=await r.json();const auth={'X-Device-Id':id,Authorization:'Bearer '+token};assert.equal((await worker.fetch(request('/api/device','GET',null,auth),env,{})).status,200);assert.equal((await worker.fetch(request('/api/device','DELETE',{}, {...auth,Authorization:'Bearer wrong'}),env,{})).status,401);assert.equal((await worker.fetch(request('/api/device','POST',{subscription:sub,token:Buffer.alloc(32,2).toString('base64url'),session:'regular',hour:19}),env,{})).status,409);
 const original=globalThis.fetch;let sends=0;globalThis.fetch=async(url,options)=>{sends++;assert.equal(url,sub.endpoint);assert.ok(options.headers);assert.ok(options.body.byteLength>0);return new Response(null,{status:201});};try{assert.equal((await worker.fetch(request('/api/test','POST',{},auth),env,{})).status,200);assert.equal((await worker.fetch(request('/api/test','POST',{},auth),env,{})).status,429);assert.equal(sends,1);}finally{globalThis.fetch=original;}
 assert.equal((await worker.fetch(request('/api/device','DELETE',{},auth),env,{})).status,200);assert.equal((await worker.fetch(request('/api/device','GET',null,auth),env,{})).status,401);
});
test('scheduler endpoint rejects unauthenticated execution and cross-origin mutation',async()=>{const env={...await credentials(),DB:database()};assert.equal((await worker.fetch(request('/api/jobs/tick','POST',{}),env,{})).status,401);assert.equal((await worker.fetch(request('/api/device','POST',{}, {Origin:'https://other.test'}),env,{})).status,403);});
test('failed refresh retains prior dates and marks error',async()=>{const env={DB:database()};const now=new Date().toISOString();const old=[{date:'2026-10-12',end:'2026-10-12',type:'closed'}];env.DB.sqlite.prepare('INSERT INTO calendars VALUES(?,?,?,?,NULL)').run('regular',JSON.stringify(old),now,now);const original=globalThis.fetch;globalThis.fetch=async()=>new Response('unavailable',{status:503});try{const row=await refreshCalendar(env,sessions[0],true);assert.deepEqual(JSON.parse(row.events),old);assert.match(row.error,/503/);}finally{globalThis.fetch=original;}});
test('delivery retry does not duplicate accepted sends; corrections and expiry work',async()=>{const env={...await credentials(),SCHEDULER_ENABLED:'true',DB:database()};const sub=await subscription(),id=await digest(sub.endpoint),now=new Date().toISOString();const current=localDate();const tomorrow=new Date(Date.parse(current+'T12:00Z')+86400000).toISOString().slice(0,10);const ev={date:tomorrow,end:tomorrow,type:'closed',title:'College closed',detail:'College closed'};for(const s of sessions)env.DB.sqlite.prepare('INSERT INTO calendars VALUES(?,?,?,?,NULL)').run(s.id,JSON.stringify([ev]),now,now);env.DB.sqlite.prepare('INSERT INTO devices(id,token_hash,subscription,session,hour,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,'hash',JSON.stringify(sub),'regular',0,now,now);
 const original=globalThis.fetch;let sends=0;globalThis.fetch=async()=>{sends++;return new Response(null,{status:201});};try{assert.equal((await tick(env)).sent,1);assert.equal((await tick(env)).sent,0);assert.equal(sends,1);env.DB.sqlite.prepare('UPDATE calendars SET events=? WHERE id=?').run(JSON.stringify([{...ev,title:'No classes scheduled',type:'no-class'}]),'regular');assert.equal((await tick(env)).sent,1);assert.equal(sends,2);env.DB.sqlite.prepare('UPDATE calendars SET events=? WHERE id=?').run('[]','regular');globalThis.fetch=async()=>new Response(null,{status:410});assert.equal((await tick(env)).removed,1);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM devices').get().n,0);}finally{globalThis.fetch=original;}
});
test('scheduler disabled cannot send and stale calendars cannot authorize alerts',async()=>{const env={...await credentials(),DB:database()};const now=new Date().toISOString();for(const s of sessions)env.DB.sqlite.prepare('INSERT INTO calendars VALUES(?,?,?,?,NULL)').run(s.id,'[]',now,now);const r=await tick(env);assert.equal(r.deliveryEnabled,false);assert.equal(r.sent,0);});

test('closed-app test waits for the scheduler, sends once, and records a receipt',async()=>{
 const env={...await credentials(),DB:database()},sub=await subscription(),token=randomBytes(32).toString('base64url');
 const {id}=await (await worker.fetch(request('/api/device','POST',{subscription:sub,token,session:'regular',hour:19}),env,{})).json();
 const auth={'X-Device-Id':id,Authorization:'Bearer '+token};
 assert.equal((await worker.fetch(request('/api/test/scheduled','POST',{},auth),env,{})).status,503);
 assert.equal((await worker.fetch(request('/api/jobs/tests','POST',{}),env,{})).status,401);
 const job=await worker.fetch(request('/api/jobs/tests','POST',null,{Authorization:'Bearer '+env.JOB_TOKEN}),env,{});assert.equal(job.status,200);
 const scheduled=await worker.fetch(request('/api/test/scheduled','POST',{},auth),env,{});assert.equal(scheduled.status,200);
 const {id:testId,dueAt}=await scheduled.json();assert.ok(Date.parse(dueAt)>Date.now());
 const original=globalThis.fetch;let sends=0;globalThis.fetch=async()=>{sends++;return new Response(null,{status:201});};
 try{
  assert.equal((await (await worker.fetch(request('/api/jobs/tests','POST',null,{Authorization:'Bearer '+env.JOB_TOKEN}),env,{})).json()).processed,0);
  assert.equal(sends,0);
  env.DB.sqlite.prepare('UPDATE scheduled_tests SET due_at=? WHERE device=?').run(new Date(Date.now()-1000).toISOString(),id);
  const done=await (await worker.fetch(request('/api/jobs/tests','POST',null,{Authorization:'Bearer '+env.JOB_TOKEN}),env,{})).json();assert.equal(done.accepted,1);
  assert.equal((await (await worker.fetch(request('/api/jobs/tests','POST',null,{Authorization:'Bearer '+env.JOB_TOKEN}),env,{})).json()).accepted,0);assert.equal(sends,1);
  const stored=env.DB.sqlite.prepare('SELECT receipt_token FROM scheduled_tests WHERE device=?').get(id);
  assert.equal((await worker.fetch(request('/api/test-receipt','POST',{id:testId,token:stored.receipt_token,state:'display_requested'}),env,{})).status,200);
  const result=await (await worker.fetch(request('/api/test/scheduled','GET',null,auth),env,{})).json();assert.equal(result.test.display_state,'display_requested');assert.ok(!('receipt_token' in result.test));
 }finally{globalThis.fetch=original;}
});

test('anonymous daily visitors are deduplicated without collecting names',async()=>{
 const env={DB:database()},visitor=randomBytes(32).toString('base64url');
 for(let i=0;i<2;i++)assert.equal((await worker.fetch(request('/api/visit','POST',{visitor}),env,{})).status,200);
 assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) n FROM daily_visitors').get().n,1);
 assert.equal((await worker.fetch(request('/api/visit','POST',{visitor:'invalid'}),env,{})).status,400);
});

test('encrypted server test decrypts independently and records only authenticated device receipts',async()=>{
 const env={...await credentials(),DB:database()},client=createECDH('prime256v1');client.generateKeys();const authSecret=randomBytes(16);
 const sub={endpoint:'https://web.push.apple.com/test',keys:{p256dh:client.getPublicKey().toString('base64url'),auth:authSecret.toString('base64url')}};
 const token=randomBytes(32).toString('base64url');const registered=await worker.fetch(request('/api/device','POST',{subscription:sub,token,session:'regular',hour:19}),env,{});
 const {id}=await registered.json(),auth={'X-Device-Id':id,Authorization:'Bearer '+token};let payload;
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{payload=Buffer.from(options.body);return new Response(null,{status:201});};
 try{
  const sent=await worker.fetch(request('/api/test','POST',{},auth),env,{});assert.equal(sent.status,200);const result=await sent.json();assert.equal(result.providerStatus,201);
  // Decode as a receiver with Node's native HKDF/AES-GCM, independently of the sending library.
  const salt=payload.subarray(0,16),server=payload.subarray(21,21+payload[20]),shared=client.computeSecret(server);
  const ikm=Buffer.from(hkdfSync('sha256',shared,authSecret,Buffer.concat([Buffer.from('WebPush: info\0'),client.getPublicKey(),server]),32));
  const cek=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16)),nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
  const encrypted=payload.subarray(21+payload[20]),decipher=createDecipheriv('aes-128-gcm',cek,nonce);decipher.setAuthTag(encrypted.subarray(-16));
  const plain=Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]);let end=plain.length-1;while(plain[end]===0)end--;assert.equal(plain[end],2);
  const data=JSON.parse(plain.subarray(0,end).toString());assert.equal(data.testId,result.testId);
  assert.equal(data.web_push,8030);assert.equal(data.notification.title,'Campus Pause · Delivery test');assert.equal(data.notification.navigate,'https://campus-pause-bmcc.gaoussou-keita441104.chatgpt.site/');
  const pending=await (await worker.fetch(request('/api/test','GET',null,auth),env,{})).json();assert.equal(pending.test.received_at,null);assert.ok(!('receipt_hash' in pending.test));
  assert.equal((await worker.fetch(request('/api/test'),env,{})).status,401);
  assert.equal((await worker.fetch(request('/api/test-receipt','POST',{id:data.testId,token:'x'.repeat(64),state:'display_requested'}),env,{})).status,404);
  const receipt={id:data.testId,token:data.receiptToken,state:'display_requested',workerVersion:'declarative-push-2'};
  assert.equal((await worker.fetch(request('/api/test-receipt','POST',receipt),env,{})).status,200);
  assert.equal((await worker.fetch(request('/api/test-receipt','POST',receipt),env,{})).status,404);
  const confirmed=await (await worker.fetch(request('/api/test','GET',null,auth),env,{})).json();assert.equal(confirmed.test.display_state,'display_requested');
  await worker.fetch(request('/api/device','DELETE',{},auth),env,{});assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM push_tests').get().n,0);
 }finally{globalThis.fetch=original;}
});

test('a failed test releases its cooldown; a successful test keeps it',async()=>{
 const env={...await credentials(),DB:database()},sub=await subscription(),token=randomBytes(32).toString('base64url');
 const {id}=await (await worker.fetch(request('/api/device','POST',{subscription:sub,token,session:'regular',hour:19}),env,{})).json(),auth={'X-Device-Id':id,Authorization:'Bearer '+token};
 const original=globalThis.fetch;
 try{
  for(const status of [503,502]){globalThis.fetch=async()=>{if(status===503)throw Error('network failure');return new Response(null,{status:500});};assert.equal((await worker.fetch(request('/api/test','POST',{},auth),env,{})).status,status);const usage=env.DB.sqlite.prepare('SELECT last_test,test_count FROM devices').get();assert.equal(usage.last_test,null);assert.equal(usage.test_count,0);}
  globalThis.fetch=async()=>new Response(null,{status:201});assert.equal((await worker.fetch(request('/api/test','POST',{},auth),env,{})).status,200);
  const blocked=await worker.fetch(request('/api/test','POST',{},auth),env,{});assert.equal(blocked.status,429);assert.ok((await blocked.json()).retryAfter>0);
 }finally{globalThis.fetch=original;}
});

test('automatic delivery tests allow ten accepted sends per rolling 24 hours',async()=>{
 const env={...await credentials(),DB:database()},sub=await subscription(),token=randomBytes(32).toString('base64url');
 const {id}=await (await worker.fetch(request('/api/device','POST',{subscription:sub,token,session:'regular',hour:19}),env,{})).json(),auth={'X-Device-Id':id,Authorization:'Bearer '+token};
 const original=globalThis.fetch;let sends=0;globalThis.fetch=async()=>{sends++;return new Response(null,{status:201});};
 try{
  for(let n=0;n<10;n++){assert.equal((await worker.fetch(request('/api/test','POST',{},auth),env,{})).status,200);env.DB.sqlite.prepare('UPDATE devices SET last_test=NULL WHERE id=?').run(id);}
  const blocked=await worker.fetch(request('/api/test','POST',{},auth),env,{}),limit=await blocked.json();assert.equal(blocked.status,429);assert.equal(limit.dailyLimit,true);assert.equal(sends,10);
  const renewed={...await subscription(),endpoint:sub.endpoint+'-renewed'},registered=await (await worker.fetch(request('/api/device','POST',{subscription:renewed,token,session:'regular',hour:19}),env,{})).json(),renewedAuth={'X-Device-Id':registered.id,Authorization:'Bearer '+token};
  assert.notEqual(registered.id,id);assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM devices WHERE id=?').get(id).n,0);const stillBlocked=await worker.fetch(request('/api/test','POST',{},renewedAuth),env,{});assert.equal(stillBlocked.status,429);assert.equal((await stillBlocked.json()).dailyLimit,true);
  env.DB.sqlite.prepare('UPDATE devices SET test_window_start=?,last_test=NULL WHERE id=?').run(new Date(Date.now()-25*3600000).toISOString(),registered.id);
  assert.equal((await worker.fetch(request('/api/test','POST',{},renewedAuth),env,{})).status,200);assert.equal(sends,11);assert.equal(env.DB.sqlite.prepare('SELECT test_count FROM devices WHERE id=?').get(registered.id).test_count,1);
 }finally{globalThis.fetch=original;}
});
