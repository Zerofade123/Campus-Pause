const messages={
 VAPID_MISSING:'Push delivery is missing a server setting.',
 VAPID_PUBLIC_KEY:'The server push public key has an invalid format.',
 VAPID_PRIVATE_KEY:'The server push private key has an invalid format.',
 VAPID_SUBJECT:'The server push contact must be a valid mailto: address or HTTPS URL.',
 VAPID_KEY_PAIR:'The server push keys are invalid or do not belong to the same pair.',
 PUSH_PAYLOAD:'The server could not prepare the encrypted notification.',
 PUSH_AUTH:'The push service rejected the server credentials or their connection to this device.',
 PUSH_REQUEST:'The push service rejected the notification request.',
 PUSH_RATE_LIMIT:'The push service is temporarily limiting requests. Try again later.',
 PUSH_PROVIDER:'The push service is temporarily unavailable.',
 PUSH_RESPONSE:'The push service returned an unexpected response.',
 PUSH_NETWORK:'The server could not reach the push service.',
 PUSH_UNKNOWN:'The notification could not be sent.'
};
export const failureMessage=(code,providerStatus=0)=>`${messages[code]||messages.PUSH_UNKNOWN} Reference: ${Object.hasOwn(messages,code)?code:'PUSH_UNKNOWN'}${Number.isInteger(providerStatus)&&providerStatus>=100&&providerStatus<=599?' (HTTP '+providerStatus+')':''}.`;
export function pushError(code,httpStatus=503,providerStatus=0){return Object.assign(Error(failureMessage(code)),{pushCode:code,httpStatus,providerStatus});}
export const failureCode=error=>Object.hasOwn(messages,error?.pushCode)?error.pushCode:'PUSH_UNKNOWN';
const cache=new WeakMap();
export async function readPushConfiguration(env){
 const values=[env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY,env.VAPID_SUBJECT].map(v=>typeof v==='string'?v.trim():'');
 const cached=cache.get(env);if(cached&&values.every((v,i)=>v===cached.values[i]))return cached.promise;
 const promise=(async()=>{
  const [publicKey,privateKey,subject]=values;
  if(!publicKey||!privateKey||!subject)throw pushError('VAPID_MISSING');
  if(!/^[A-Za-z0-9_-]{87}$/.test(publicKey))throw pushError('VAPID_PUBLIC_KEY');
  if(!/^[A-Za-z0-9_-]{43}$/.test(privateKey))throw pushError('VAPID_PRIVATE_KEY');
  let validContact=/^mailto:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(subject);
  try{const url=new URL(subject);validContact ||= url.protocol==='https:'&&!!url.hostname&&url.hostname!=='localhost'&&!url.username&&!url.password;}catch{}
  if(!validContact)throw pushError('VAPID_SUBJECT');
  try{
   const raw=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   if(raw.length!==65||raw[0]!==4)throw Error('Invalid point');
   const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const algorithm={name:'ECDSA',namedCurve:'P-256'},signing={name:'ECDSA',hash:'SHA-256'};
   const privateCryptoKey=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:encode(raw.slice(1,33)),y:encode(raw.slice(33)),d:privateKey},algorithm,false,['sign']);
   const publicCryptoKey=await crypto.subtle.importKey('raw',raw,algorithm,false,['verify']);
   const challenge=new TextEncoder().encode('Campus Pause push key check');
   const signature=await crypto.subtle.sign(signing,privateCryptoKey,challenge);
   if(!await crypto.subtle.verify(signing,publicCryptoKey,signature,challenge))throw Error('Key mismatch');
  }catch{throw pushError('VAPID_KEY_PAIR');}
  return {publicKey,privateKey,subject};
 })();
 cache.set(env,{values,promise});return promise;
}
export async function pushConfigurationStatus(env){try{await readPushConfiguration(env);return {ready:true,code:null};}catch(error){return {ready:false,code:failureCode(error)};}}
