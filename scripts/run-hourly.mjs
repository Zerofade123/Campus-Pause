// Deploy on the existing Oracle server with Node 20+ and an hourly cron entry.
// Secrets belong in the server's environment, never source or command arguments.
const origin=process.env.CAMPUS_PAUSE_ORIGIN;
const token=process.env.CAMPUS_PAUSE_JOB_TOKEN;
if(!origin||!token||!origin.startsWith('https://'))throw Error('Missing HTTPS origin or job token');
let cursor='';let total=0;
for(let i=0;i<100;i++){
 const url=new URL('/api/jobs/tick',origin);if(cursor)url.searchParams.set('cursor',cursor);
 const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(150000)});
 if(!response.ok)throw Error('Reminder job failed: HTTP '+response.status);
 const result=await response.json();if(result.busy)throw Error('Another reminder job is still running');
 total+=result.sent;cursor=result.nextCursor;console.log(JSON.stringify({sent:result.sent,failed:result.failed,calendarsChecked:result.calendarsChecked,more:!!cursor}));
 if(!cursor){if(result.calendarsChecked!==5||result.failed)process.exitCode=1;break;}if(i===99)throw Error('Delivery batch limit reached');
}
console.log('Accepted push deliveries: '+total);
