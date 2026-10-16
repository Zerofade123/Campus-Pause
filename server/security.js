// Layered abuse controls. These counters are local to a Cloudflare location;
// database-backed per-device test quotas remain the authoritative test limit.
export async function checkWriteLimit(request,env){
 if(env.PUBLIC_LIMITING_ENABLED!=='true')return null;
 if(!env.PUBLIC_WRITE_LIMIT||!env.PUBLIC_TOTAL_LIMIT)return new Response(JSON.stringify({error:'Request protection is temporarily unavailable. Please retry shortly.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 const raw=new TextEncoder().encode(new Date().toISOString().slice(0,10)+':'+(request.headers.get('CF-Connecting-IP')||'unknown'));
 const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),b=>b.toString(16).padStart(2,'0')).join('');
 const local=await env.PUBLIC_WRITE_LIMIT.limit({key});
 const overall=local.success?await env.PUBLIC_TOTAL_LIMIT.limit({key:'campus-pause-public-writes'}):{success:false};
 if(local.success&&overall.success)return null;
 return new Response(JSON.stringify({error:'Too many requests. Please wait a minute and try again.',retryAfter:60}),{status:429,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'60'}});
}
export function secureResponse(response){
 const secured=new Response(response.body,response);
 const headers=secured.headers;
 headers.set('X-Content-Type-Options','nosniff');
 headers.set('X-Frame-Options','DENY');
 headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
 return secured;
}
