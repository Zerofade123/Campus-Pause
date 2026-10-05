import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../server/index.js';

test('Worker serves PNG assets as original binary bytes with correct MIME and HEAD behavior',async()=>{
 for(const name of ['favicon.png','apple-touch-icon.png','icon-192.png','icon-512.png','share-card.png']){
  const url='https://pause.zerofadecloud.com/'+name;
  const response=await worker.fetch(new Request(url),{},{});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/png');
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes,readFileSync('public/'+name));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const head=await worker.fetch(new Request(url,{method:'HEAD'}),{},{});
  assert.equal(head.status,200);
  assert.equal((await head.arrayBuffer()).byteLength,0);
 }
});
