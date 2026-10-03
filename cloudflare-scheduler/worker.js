// Cloudflare Cron calls the Site's authenticated jobs. No student data or
// push subscriptions live in this Worker.
async function invoke(origin, token, pathname, cursor='') {
  const url=new URL(pathname,origin);
  if(cursor)url.searchParams.set('cursor',cursor);
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok)throw Error(`${pathname}: HTTP ${response.status}`);
  return response.json();
}
export default {
  async scheduled(controller,env,ctx) {
    const origin=env.CAMPUS_PAUSE_ORIGIN;
    const token=env.CAMPUS_PAUSE_JOB_TOKEN;
    if(!origin?.startsWith('https://')||!token)throw Error('Scheduler configuration missing');
    if(controller.cron==='* * * * *'){
      const result=await invoke(origin,token,'/api/jobs/tests');
      if(result.failed)throw Error(`${result.failed} scheduled notification test(s) failed`);
      return;
    }
    if(controller.cron==='0 * * * *'){
      let cursor='';
      for(let page=0;page<100;page++){
        const result=await invoke(origin,token,'/api/jobs/tick',cursor);
        if(result.busy)throw Error('Hourly calendar check was already running');
        if(result.calendarsChecked!==5||result.failed)throw Error('Calendar check or reminder delivery failed');
        cursor=result.nextCursor;
        if(!cursor)return;
      }
      throw Error('Reminder batch exceeded 100 pages');
    }
  }
};
