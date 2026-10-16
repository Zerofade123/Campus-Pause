import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/index.js';
import {serveSetupVideo} from '../server/media.js';
const url='https://pause.zerofadecloud.com';
const post=(body,headers={})=>new Request(url+'/api/visit',{method:'POST',headers:{Origin:url,'Content-Type':'application/json',...headers},body});

test('unauthenticated device/test access and retired setup pages reveal no private data',async()=>{
 for(const path of ['/api/device','/api/test','/api/test/scheduled']){
  const r=await worker.fetch(new Request(url+path),{},{});assert.equal(r.status,401);
 }
 for(const path of ['/setup-vapid.html','/.env','/wrangler.jsonc','/api/admin','/api/devices']){
  const r=await worker.fetch(new Request(url+path),{},{});assert.equal(r.status,404);
 }
 const r=await worker.fetch(new Request(url+'/api/jobs/tick',{method:'POST'}),{},{});assert.equal(r.status,401);
});
test('security headers protect pages and error responses without blocking local media',async()=>{
 for(const path of ['/','/api/device']){
  const r=await worker.fetch(new Request(url+path),{},{});
  assert.equal(r.headers.get('X-Frame-Options'),'DENY');
  assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.match(r.headers.get('Content-Security-Policy'),/media-src 'self'/);
  assert.match(r.headers.get('Content-Security-Policy'),/script-src 'self'/);
 }
});
test('write requests reject oversized/chunked JSON, primitives and cross-origin writes before D1',async()=>{
 for(const value of ['null','[]','true'])assert.equal((await worker.fetch(post(value),{},{})).status,400);
 assert.equal((await worker.fetch(post('{}',{Origin:'https://elsewhere.test'}),{},{})).status,403);
 assert.equal((await worker.fetch(post('{}',{'Content-Type':'text/plain; application/json'}),{},{})).status,415);
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(5000));c.enqueue(new Uint8Array(5000));c.close();}});
 const req=new Request(url+'/api/visit',{method:'POST',duplex:'half',headers:{Origin:url,'Content-Type':'application/json'},body:stream});
 assert.equal((await worker.fetch(req,{},{})).status,413);
});
test('edge limits reject writes before database access, hash network keys, and fail closed if missing',async()=>{
 let captured;
 const env={PUBLIC_LIMITING_ENABLED:'true',PUBLIC_WRITE_LIMIT:{limit:async({key})=>{captured=key;return {success:false};}},PUBLIC_TOTAL_LIMIT:{limit:async()=>{throw Error('Should not run');}}};
 const r=await worker.fetch(post('{}',{'CF-Connecting-IP':'192.0.2.5'}),env,{});
 assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');assert.match(captured,/^[a-f0-9]{64}$/);assert.ok(!captured.includes('192.0.2.5'));
 assert.equal((await worker.fetch(post('{}'),{PUBLIC_LIMITING_ENABLED:'true'},{})).status,503);
});
test('video serves full, HEAD, first-byte, suffix and invalid range responses for Safari',async()=>{
 const env={MEDIA:{fetch:async req=>{assert.equal(req.headers.get('Range'),null);return new Response(new Uint8Array([0,1,2,3,4,5]),{headers:{'Content-Length':'6',ETag:'"video"'}});}}};
 const get=(method='GET',headers={})=>serveSetupVideo(new Request(url+'/setup/iphone-setup.mp4',{method,headers}),env);
 const first=await get('GET',{Range:'bytes=0-1'});assert.equal(first.status,206);assert.equal(first.headers.get('Content-Range'),'bytes 0-1/6');assert.deepEqual([...new Uint8Array(await first.arrayBuffer())],[0,1]);
 const suffix=await get('GET',{Range:'bytes=-2'});assert.equal(suffix.status,206);assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())],[4,5]);
 assert.equal((await get('GET',{Range:'bytes=9-10'})).status,416);
 assert.equal((await get('GET',{Range:'bytes=0-1','If-Range':'"old"'})).status,200);
 assert.equal((await get('HEAD')).body,null);assert.equal((await get()).headers.get('Content-Type'),'video/mp4');
 assert.equal((await get('POST')).status,405);
});
