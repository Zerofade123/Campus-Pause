import {prepareNotificationWorker} from './notification-worker.js';
const enableButton=document.getElementById('enable-notifications'),installButton=document.getElementById('install-app'),testButton=document.getElementById('test-notification'),stopButton=document.getElementById('stop-reminders'),statusText=document.getElementById('notification-status');
const localTestButton=document.getElementById('local-notification-test'),localTestStatus=document.getElementById('local-test-status');
const scheduledButton=document.getElementById('scheduled-notification-test'),scheduledStatus=document.getElementById('scheduled-test-status');
const repairButton=document.getElementById('repair-connection'),repairStatus=document.getElementById('repair-status');
let testCooldown=0,cooldownTimer=null;
const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const isAndroid=/Android/i.test(navigator.userAgent);
const isWindows=/Windows/i.test(navigator.userAgent);
const isMac=!isIOS&&/Mac/i.test(navigator.platform||navigator.userAgent);
const notificationHelp=isIOS?'Check iPhone Settings → Notifications → Campus Pause, including Banners and Lock Screen, and turn off Focus or Sleep mode.':isWindows?'Check Windows Settings → System → Notifications, allow notifications for your browser or Campus Pause, and turn off Do not disturb or Focus assist.':isMac?'Check System Settings → Notifications for your browser or Campus Pause, and turn off Focus.':isAndroid?'Check Android notification settings for your browser or Campus Pause, and turn off Do Not Disturb.':'Check your browser and system notification settings, including Do Not Disturb.';
document.getElementById('notification-device-help').textContent='No banner? '+notificationHelp;
const closeTestHelp=(isIOS||isAndroid)?'Close the app, then reopen it after the alert.':'Close the Campus Pause tab or app, but leave the browser running for this first test.';
document.getElementById('closed-test-help').textContent=closeTestHelp;
let standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;
let deferredInstallPrompt=null;
const installDialog=document.getElementById('install-dialog');
const installHint=document.getElementById('install-hint');
let config=null,registration=null,device=null,busy=false;
try{device=JSON.parse(localStorage.getItem('campus-pause-device')||'null');testCooldown=Number(localStorage.getItem('campus-pause-test-retry-at'))||0;const hour=localStorage.getItem('campus-pause-time');if(['18','19','20'].includes(hour))document.getElementById('reminder-time').value=hour;}catch{}
function headers(){return {'Content-Type':'application/json',...(device?{'X-Device-Id':device.id,'Authorization':'Bearer '+device.token}:{})};}
async function api(path,method='GET',body){const response=await fetch(path,{method,headers:headers(),...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error),{status:response.status,retryAfter:data.retryAfter,dailyLimit:data.dailyLimit,retryAt:data.retryAt});return data;}
function state(){
 document.getElementById('notification-tests').hidden=!device;
 document.getElementById('scheduler-note').hidden=!!config?.scheduler?.healthy;
 testButton.hidden=!device;stopButton.hidden=!device;enableButton.hidden=!!device;installButton.hidden=true;installHint.hidden=true;enableButton.disabled=false;
 localTestButton.hidden=!device||!(window.isSecureContext&&'serviceWorker' in navigator&&'Notification' in window&&Notification.permission==='granted'&&(!isIOS||standalone));
 scheduledButton.hidden=localTestButton.hidden;
 scheduledButton.disabled=!config?.scheduler?.testReady||Date.now()<testCooldown;
 if(!scheduledButton.hidden&&!config?.scheduler?.testReady)scheduledStatus.textContent='Closed-app testing will be available when the background scheduler is connected.';
 repairButton.hidden=!device;
 if(device){statusText.textContent=config?.scheduler?.healthy?'Reminders active for this device.':'Notifications are allowed. You can test delivery; automatic reminders are not active yet.';return;}
 if(isIOS&&!standalone){enableButton.hidden=true;installButton.hidden=false;installButton.textContent='Add to Home Screen';installHint.hidden=false;installHint.textContent='iPhone users: this works in Safari or Chrome. Tap the button for the Share → Add to Home Screen steps.';statusText.textContent='Add it once, then open the Home Screen icon to enable reminders.';return;}
 if(!window.isSecureContext||!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window)){enableButton.disabled=true;statusText.textContent='Push reminders are unavailable in this browser. You can still read the calendar.';return;}
 if(isAndroid&&!standalone){installHint.hidden=false;installHint.textContent=deferredInstallPrompt?'Android users: your browser can open the install prompt here. If it does not appear, use the browser menu and choose Install app or Add to Home Screen.':'Android users can enable notifications directly. Installing the app is optional; if your browser offers Install app or Add to Home Screen, you can use it from the browser menu.';}
 if(deferredInstallPrompt&&!standalone){installButton.hidden=false;installButton.textContent=isAndroid?'Add to Home Screen':'Install Campus Pause';}
 enableButton.disabled=!config;enableButton.textContent=Notification.permission==='denied'?'How to unblock notifications':'Enable notifications';statusText.textContent=Notification.permission==='denied'?'Open your browser’s site permissions and allow notifications for this site, then return here.':!config?'Connecting to reminder service…':config.scheduler?.healthy?'Allow notifications to receive reminders on this device.':'Allow notifications to register this device. Automatic delivery is being set up.';
}
const base64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function saveDevice(sub,token){const result=await api('/api/device','POST',{subscription:sub.toJSON(),token,session:document.getElementById('session').value,hour:+document.getElementById('reminder-time').value});device={id:result.id,token};localStorage.setItem('campus-pause-device',JSON.stringify(device));config.scheduler=result.scheduler;state();}
function showInstallGuide(){if(installDialog?.showModal)installDialog.showModal();else statusText.textContent='Open Safari’s Share menu, choose Add to Home Screen, then open the new icon.';}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;state();});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;standalone=true;state();statusText.textContent='Campus Pause was installed. Open it to enable reminders.';});
installButton.addEventListener('click',async()=>{
 if(busy)return;
 if(deferredInstallPrompt){busy=true;installButton.disabled=true;try{deferredInstallPrompt.prompt();const result=await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;statusText.textContent=result.outcome==='accepted'?'App installed. Open Campus Pause to enable reminders.':'You can install Campus Pause whenever you are ready.';}catch(error){statusText.textContent=error.message||'Install prompt could not open. You can use your browser’s Add to Home Screen menu.';}finally{busy=false;installButton.disabled=false;state();}return;}
 showInstallGuide();
});
document.getElementById('close-install-dialog').addEventListener('click',()=>installDialog.close());
document.getElementById('done-install').addEventListener('click',()=>installDialog.close());
enableButton.addEventListener('click',async()=>{
 if(!config||busy)return;if(Notification.permission==='denied'){state();return;}busy=true;enableButton.disabled=true;let freshSub=null;
 try{const permission=await Notification.requestPermission();if(permission!=='granted'){state();statusText.textContent='Notifications were not allowed. You can enable them later.';return;}
  let token=localStorage.getItem('campus-pause-token');if(!token){token=base64(crypto.getRandomValues(new Uint8Array(32)));localStorage.setItem('campus-pause-token',token);}
  registration=await prepareNotificationWorker();let sub=await registration.pushManager.getSubscription();if(!sub){sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(config.publicKey)});freshSub=sub;}await saveDevice(sub,token);
 }catch(error){if(freshSub)await freshSub.unsubscribe().catch(()=>{});state();statusText.textContent=error.message||'Registration failed. Please try again.';}
 finally{busy=false;if(!device)enableButton.disabled=!config;}
});
function startCooldown(seconds){
 testCooldown=Date.now()+seconds*1000;try{localStorage.setItem('campus-pause-test-retry-at',String(testCooldown));}catch{}clearInterval(cooldownTimer);
 const update=()=>{const left=Math.max(0,Math.ceil((testCooldown-Date.now())/1000));localTestButton.disabled=left>0;scheduledButton.disabled=left>0||!config?.scheduler?.testReady;const wait=left>=3600?Math.ceil(left/3600)+'h':Math.floor(left/60)+'m '+left%60+'s';localTestButton.textContent='Send test notification';scheduledButton.textContent='Test after closing the app';document.getElementById('test-cooldown').textContent=left?'Server tests available again in '+wait+'.':'';if(!left)clearInterval(cooldownTimer);};
 update();cooldownTimer=setInterval(update,1000);
}
async function watchTest(testId){
 for(let attempt=0;attempt<10;attempt++){
  await new Promise(resolve=>setTimeout(resolve,1500));
  const {test}=await api('/api/test');
  if(test?.id!==testId)continue;
  if(test.display_state==='display_requested'){localTestStatus.textContent='Automatic delivery reached this device and requested a notification.';return;}
  if(test.display_state==='display_failed'){localTestStatus.textContent='Automatic delivery reached this device, but the notification could not be displayed.';return;}
 }
 localTestStatus.textContent='The push service accepted the test. No automatic receipt was returned; if you saw the notification, delivery worked. Otherwise, check Notification Center and the help below.';
}
testButton.addEventListener('click',async()=>{
 testButton.disabled=true;statusText.textContent='Creating a notification on this device…';
 try{
  // The instant test uses the active worker. Updating belongs to the separate
  // automatic-delivery repair flow and would add avoidable network latency.
  registration=registration||await navigator.serviceWorker.getRegistration()||await navigator.serviceWorker.ready;
  const tag='campus-pause-device-test-'+Date.now();
  await registration.showNotification('Campus Pause · Notification test',{body:'Notifications are working on this device.',tag,renotify:true,silent:false,icon:'/icon.svg',data:{url:'/'}});
  const active=await registration.getNotifications({tag});
  statusText.textContent=active.length
   ?'The browser created the notification. If no banner appeared, '+notificationHelp
   :'The browser accepted the display request, but no active notification was found. '+notificationHelp;
 }catch(error){statusText.textContent=error.message||'This device could not show the notification test.';}
 finally{testButton.disabled=false;}
});
localTestButton.addEventListener('click',async()=>{
 if(!config){localTestStatus.textContent='The reminder service is still connecting. Please try again in a moment.';return;}
 if(localTestButton.disabled)return;let dailyBlocked=false;localTestButton.disabled=true;localTestStatus.textContent='Sending test notification…';
 try{
  // Setup/repair owns service-worker updates and registration. Send directly
  // using the authenticated device already stored on the server.
  const result=await api('/api/test','POST',{});startCooldown(result.retryAfter||300);
  localTestStatus.textContent='The push service accepted the test. Waiting for this device to confirm receipt…';
  try{await watchTest(result.testId);}catch{localTestStatus.textContent='The test was accepted, but its receipt could not be checked.';}
 }catch(error){
  if(error.status===410){await (await registration?.pushManager.getSubscription())?.unsubscribe().catch(()=>{});device=null;}
  if(!device){localStorage.removeItem('campus-pause-device');state();}
  localTestStatus.textContent=error.message||'The automatic-delivery test could not be completed.';
  if(error.dailyLimit){dailyBlocked=true;localTestButton.disabled=true;document.getElementById('test-cooldown').textContent='Daily server-test limit reached.';if(error.retryAt)localTestStatus.textContent+=' Try again after '+new Date(error.retryAt).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+'.';}
  if(error.retryAfter)startCooldown(error.retryAfter);
 }finally{if(!dailyBlocked&&Date.now()>=testCooldown)localTestButton.disabled=false;}
});
async function scheduledResult(){
 if(!device)return;
 try{const {test}=await api('/api/test/scheduled');if(!test)return;
  const failed=test.display_state?.startsWith('send_failed')||(test.dispatched_at&&test.provider_status!==null&&(test.provider_status<200||test.provider_status>=300));
  const accepted=test.provider_status>=200&&test.provider_status<300;
  const message=test.error||(test.display_state==='display_requested'?'The device requested a notification. Confirm whether you saw it while the app was closed.':test.display_state==='display_failed'?'The test reached this device but could not display an alert.':failed?'The scheduled test could not be sent. Check the service and try again.':accepted?'The push service accepted the test. If you saw the alert, delivery worked; an automatic receipt may not be available.':test.dispatched_at?'Sending the scheduled test; provider acceptance is not confirmed yet.':'Your test is queued. It usually arrives within a few minutes, but timing varies. '+closeTestHelp);
  scheduledStatus.textContent=message;
 }catch{}
}
scheduledButton.addEventListener('click',async()=>{
 if(scheduledButton.disabled)return;scheduledButton.disabled=true;scheduledStatus.textContent='Scheduling a test for this device…';
 try{
  const result=await api('/api/test/scheduled','POST',{});
  startCooldown(result.retryAfter||300);
  scheduledStatus.textContent='Test queued. Close the app now. It usually arrives within a few minutes; the exact arrival time varies. '+closeTestHelp;
 }catch(error){scheduledStatus.textContent=error.message||'The test could not be scheduled.';if(error.retryAfter)startCooldown(error.retryAfter);}
 finally{scheduledButton.disabled=!config?.scheduler?.testReady||Date.now()<testCooldown;}
});
repairButton.addEventListener('click',async()=>{
 repairButton.disabled=true;repairStatus.textContent='Renewing this device’s push connection…';
 try{
  registration=await prepareNotificationWorker();const oldSub=await registration.pushManager.getSubscription();
  await oldSub?.unsubscribe().catch(()=>{});
  const token=localStorage.getItem('campus-pause-token')||base64(crypto.getRandomValues(new Uint8Array(32)));localStorage.setItem('campus-pause-token',token);
  const sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(config.publicKey)});
  await saveDevice(sub,token);repairStatus.textContent='Connection repaired. Now tap “Send test notification.”';
 }catch(error){await api('/api/device','DELETE',{}).catch(()=>{});device=null;localStorage.removeItem('campus-pause-device');state();repairStatus.textContent=error.message||'The connection could not be repaired. Enable notifications again.';}
 finally{repairButton.disabled=false;}
});
stopButton.addEventListener('click',async()=>{stopButton.disabled=true;try{await api('/api/device','DELETE',{});registration=await navigator.serviceWorker.getRegistration();await (await registration?.pushManager.getSubscription())?.unsubscribe();localStorage.removeItem('campus-pause-device');device=null;state();statusText.textContent='Device removed. Reminders are off.';}catch(error){statusText.textContent=error.message;}finally{stopButton.disabled=false;}});
document.getElementById('save').onclick=async()=>{const saved=document.getElementById('saved-state');try{localStorage.setItem('campus-pause-time',document.getElementById('reminder-time').value);if(device){registration=await navigator.serviceWorker.getRegistration();const sub=await registration?.pushManager.getSubscription();if(!sub)throw Error('Browser registration missing. Stop reminders and enable them again.');await saveDevice(sub,device.token);saved.textContent='Session and time saved to the reminder service.';}else saved.textContent='Preference saved on this device. Enable notifications to register.';}catch(error){saved.textContent=error.message;}};
document.getElementById('session').addEventListener('change',()=>{if(device)document.getElementById('saved-state').textContent='To change your reminder session too, tap Save reminder preference.';});
state();window.campusConfig.then(async data=>{config=data;if(device){try{const current=await api('/api/device');config.scheduler=current.scheduler;document.getElementById('reminder-time').value=String(current.hour);}catch(error){if(error.status===401){device=null;localStorage.removeItem('campus-pause-device');}else{statusText.textContent='Could not confirm reminder status. Please try again.';return;}}}state();if(testCooldown>Date.now())startCooldown(Math.ceil((testCooldown-Date.now())/1000));scheduledResult();}).catch(()=>{statusText.textContent='Reminder service unavailable. Please refresh and try again.';});
