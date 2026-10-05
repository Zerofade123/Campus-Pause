import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('registered-device send reaches the push endpoint before updates, registration writes, or receipt timers',async()=>{
 const elements=new Map(),requests=[];let preparations=0;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{value:id==='session'?'regular':'19',hidden:false,disabled:false,textContent:'',handlers:{},addEventListener(name,handler){this.handlers[name]=handler;}});
  return elements.get(id);
 };
 const saved=new Map([['campus-pause-device',JSON.stringify({id:'test-device',token:'test-token'})]]);
 const config={publicKey:'test',scheduler:{healthy:true,testReady:true}};
 const context={
  document:{getElementById:element},
  navigator:{userAgent:'Test browser',platform:'Linux',maxTouchPoints:0,serviceWorker:{}},
  Notification:{permission:'granted'},
  localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)},
  window:{isSecureContext:true,serviceWorker:{},Notification:{},PushManager:{},matchMedia:()=>({matches:false}),addEventListener(){},campusConfig:Promise.resolve(config)},
  prepareNotificationWorker:async()=>{preparations++;throw Error('An update must not delay a send');},
  fetch:async(path,options)=>{
   requests.push({path,method:options.method});
   let data=path==='/api/device'?{hour:19,scheduler:config.scheduler}:path==='/api/test/scheduled'?{test:null}:path==='/api/test'?{accepted:true,testId:'sent-test',retryAfter:60}:{};
   return {ok:true,json:async()=>data};
  },
  setTimeout(){},setInterval(){return 1;},clearInterval(){},Date,console,
 };
 const source=readFileSync('public/notifications.js','utf8').replace(/^import .*\n/,'');
 vm.runInNewContext(source,context);
 await new Promise(resolve=>setImmediate(resolve));
 requests.length=0;
 void element('local-notification-test').handlers.click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(preparations,0);
 assert.deepEqual(requests,[{path:'/api/test',method:'POST'}]);
 assert.match(element('local-test-status').textContent,/accepted/);
});
