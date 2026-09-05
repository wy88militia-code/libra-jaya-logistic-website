import { listPhase1MarketplaceBatches, syncPhase1MarketplaceBatch } from './_phase1-marketplace-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

export default async ()=>{
  const batches=await listPhase1MarketplaceBatches(300),terminal=new Set(['COMPLETED','CANCELLED','SETUP_FAILED']),active=batches.filter(b=>b.manifestId&&!terminal.has(String(b.status||'').toUpperCase())),results=[];
  for(const batch of active){try{const row=await syncPhase1MarketplaceBatch(batch.batchId,'scheduled-phase1-marketplace');results.push({batchId:batch.batchId,ok:true,status:row.status,manifestStatus:row.manifestStatus});}catch(error){results.push({batchId:batch.batchId,ok:false,error:String(error?.message||error).slice(0,300)});}}
  const failed=results.filter(x=>!x.ok),message=`Phase1 marketplace • active ${active.length} • synced ${results.length-failed.length} • failed ${failed.length}`;
  await markSystemHeartbeat('PHASE1_MARKETPLACE',{status:failed.length?'ERROR':'OK',message,metadata:{active:active.length,synced:results.length-failed.length,failed:failed.length,setupFailed:batches.filter(b=>String(b.status||'').toUpperCase()==='SETUP_FAILED').length}}).catch(()=>{});
  console.log(JSON.stringify({event:'LIBRA_PHASE1_MARKETPLACE_SYNC',active:active.length,failed:failed.length,results,finishedAt:new Date().toISOString()}));
  if(failed.length)throw new Error(`${failed.length} batch Phase1 gagal sinkron.`);
};

export const config={schedule:'*/5 * * * *'};
