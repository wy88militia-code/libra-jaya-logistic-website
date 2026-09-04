import { autoSyncMasterSheet } from './_master-sheet-core.mjs';
import { writeBackPilotMaster } from './_master-writeback-core.mjs';

export default async ()=>{
  const snapshot=await autoSyncMasterSheet('SCHEDULED_5_MIN');
  let writeBack=null,writeBackError='';
  try{writeBack=await writeBackPilotMaster(snapshot);}catch(error){writeBackError=String(error?.message||error);}
  console.log(JSON.stringify({event:'LIBRA_MASTER_AUTO_SYNC',version:snapshot.version,syncedAt:snapshot.syncedAt,stats:snapshot.stats,changes:snapshot.changes,writeBack,writeBackError}));
};

export const config={schedule:'*/5 * * * *'};
