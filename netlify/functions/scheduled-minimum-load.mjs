import { runMinimumLoadConsolidation } from './_consolidation-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

export default async ()=>{
  try{
    const result=await runMinimumLoadConsolidation();
    await markSystemHeartbeat('MINIMUM_LOAD',{status:result.errors?'ERROR':'OK',message:result.errors?`${result.errors} batch minimum-load error.`:`${result.groups} grup diperiksa; ${result.pending} menunggu top-up.`,metadata:result});
    console.log(JSON.stringify({event:'LIBRA_MINIMUM_LOAD_CONSOLIDATION',...result}));
  }catch(error){await markSystemHeartbeat('MINIMUM_LOAD',{status:'ERROR',message:String(error?.message||error)}).catch(()=>{});throw error;}
};

export const config={schedule:'*/15 * * * *'};
