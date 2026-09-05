import { runAccurateAutoSync } from './_accurate-auto-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

export default async ()=>{
  try{
    const result=await runAccurateAutoSync({limit:60});
    const counts=result?.counts||{};
    const bad=(counts.RECONCILE_REQUIRED||0)+(counts.POST_FAILED||0)+(counts.EXCEPTION||0);
    await markSystemHeartbeat('ACCURATE_AUTO',{
      status:result?.ok===false?'ERROR':'OK',
      message:result?.skipped?`Accurate Auto skipped: ${String(result.reason||'unknown').slice(0,360)}`:`Processed ${result?.processed||0} • Posted ${counts.POSTED||0} • Reconcile ${counts.RECONCILE_REQUIRED||0} • Failed ${counts.POST_FAILED||0} • Exception ${counts.EXCEPTION||0}`,
      metadata:{processed:result?.processed||0,counts,skipped:Boolean(result?.skipped),bad}
    }).catch(()=>{});
    console.log(JSON.stringify({event:'LIBRA_ACCURATE_AUTO',ok:result?.ok,skipped:result?.skipped,reason:result?.reason||null,processed:result?.processed||0,counts,finishedAt:result?.finishedAt||new Date().toISOString()}));
  }catch(error){
    const message=String(error?.message||error).slice(0,500);
    await markSystemHeartbeat('ACCURATE_AUTO',{status:'ERROR',message}).catch(()=>{});
    console.error(JSON.stringify({event:'LIBRA_ACCURATE_AUTO_ERROR',error:message}));
    throw error;
  }
};

export const config={schedule:'*/5 * * * *'};
