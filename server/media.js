// Safari needs byte-range support for reliable seeking and video playback.
// Fetch the file from Workers Static Assets; never put video bytes in the JS bundle.
export async function serveSetupVideo(request,env){
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
 if(!env.MEDIA)return new Response('Video temporarily unavailable',{status:503});
 const upstreamHeaders=new Headers(request.headers);
 for(const key of ['range','if-range','if-none-match','if-modified-since'])upstreamHeaders.delete(key);
 const asset=await env.MEDIA.fetch(new Request(request.url,{method:'GET',headers:upstreamHeaders}));
 if(!asset.ok)return asset;
 const headers=new Headers(asset.headers);headers.set('Content-Type','video/mp4');headers.set('Accept-Ranges','bytes');headers.set('Cache-Control','public, max-age=3600');
 if(request.method==='HEAD')return new Response(null,{status:200,headers});
 const range=request.headers.get('Range'),ifRange=request.headers.get('If-Range');
 if(!range||(ifRange&&ifRange!==headers.get('ETag')&&ifRange!==headers.get('Last-Modified')))return new Response(asset.body,{status:200,headers});
 const match=/^bytes=(\d*)-(\d*)$/.exec(range);
 // A malformed/multiple range can be ignored with a full response.
 if(!match||(!match[1]&&!match[2]))return new Response(asset.body,{status:200,headers});
 const bytes=await asset.arrayBuffer(),length=bytes.byteLength;
 let start=match[1]?Number(match[1]):Math.max(0,length-Number(match[2]));
 let end=match[1]?(match[2]?Number(match[2]):length-1):length-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=length||start>end){headers.set('Content-Range','bytes */'+length);headers.delete('Content-Length');return new Response(null,{status:416,headers});}
 end=Math.min(end,length-1);headers.set('Content-Range',`bytes ${start}-${end}/${length}`);headers.set('Content-Length',String(end-start+1));
 return new Response(bytes.slice(start,end+1),{status:206,headers});
}
