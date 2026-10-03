import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {WORKER_VERSION,prepareNotificationWorker} from '../public/notification-worker.js';

test('service worker requests display before receipt, reports display failure, and handles ordinary pushes',async()=>{
 const listeners={},calls=[];let rejected=false;
 const self={location:{origin:'https://example.org'},addEventListener:(name,fn)=>listeners[name]=fn,
  registration:{showNotification:async(title,options)=>{calls.push({type:'display',title,options});if(rejected)throw Error('permission revoked');}}};
 vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{self,URL,fetch:async(url,options)=>{calls.push({type:'receipt',url,body:JSON.parse(options.body)});}});
 let observed;listeners.message({data:{type:'NOTIFICATION_VERSION'},ports:[{postMessage:x=>observed=x}]});assert.equal(observed.version,WORKER_VERSION);
 const dispatch=async data=>{let pending;listeners.push({data:{json:()=>data},waitUntil:p=>pending=p});await pending;};
 await dispatch({web_push:8030,notification:{title:'test',body:'message',navigate:'https://bad.example',tag:'tag'},testId:'test-id',receiptToken:'token'});
 assert.deepEqual(calls.map(c=>c.type),['display','receipt']);assert.equal(calls[0].options.data.url,'https://example.org/');assert.equal(calls[1].body.state,'display_requested');
 calls.length=0;rejected=true;await dispatch({title:'test',testId:'test-id',receiptToken:'token'});assert.equal(calls[1].body.state,'display_failed');
 calls.length=0;rejected=false;await dispatch({title:'ordinary reminder'});assert.equal(calls.length,1);
});

test('prepare notification delivery waits for the updated active worker instead of using a legacy worker',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');let registrationOptions,updates=0;
 const updated={postMessage:(message,ports)=>ports[0].postMessage({version:WORKER_VERSION})};
 const registration={active:{postMessage(){}},update:async()=>{updates++;registration.active=updated;}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{register:async(url,options)=>{assert.equal(url,'/sw.js');registrationOptions=options;return registration;}}}});
 try{assert.equal(await prepareNotificationWorker(),registration);assert.equal(updates,1);assert.equal(registrationOptions.updateViaCache,'none');}
 finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
