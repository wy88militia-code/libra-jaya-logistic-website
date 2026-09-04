import { autoSyncMasterSheet } from './_master-sheet-core.mjs';
import { writeBackPilotMaster } from './_master-writeback-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

export default async ()=>{
  try{
    const snapshot=await autoSyncMasterSheet('SCHEDULED_5_MIN');
    let writeBack=null,writeBackError='';
    try{writeBack=await writeBackPilotMaster(snapshot);}catch(error){writeBackError=String(error?.message||error);}
    await markSystemHeartbeat('MASTER_SYNC',{status:writeBackError?'ERROR':'OK',message:writeBackError||`Master ${snapshot.stats?.totalRoutes||0} rute tersinkron.`,metadata:{version:snapshot.version,syncedAt:snapshot.syncedAt,stats:snapshot.stats,writeBack,writeBackError}});
    console.log(JSON.stringify({event:'LIBRA_MASTER_AUTO_SYNC',version:snapshot.version,syncedAt:snapshot.syncedAt,stats:snapshot.stats,changes:snapshot.changes,writeBack,writeBackError}));
  }catch(error){await markSystemHeartbeat('MASTER_SYNC',{status:'ERROR',message:String(error?.message||error)}).catch(()=>{});throw error;}
};

export const config={schedule:'*/5 * * * *'};
