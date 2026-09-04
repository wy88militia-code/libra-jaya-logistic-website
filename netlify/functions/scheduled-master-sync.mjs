import { autoSyncMasterSheet } from './_master-sheet-core.mjs';

export default async ()=>{
  const snapshot=await autoSyncMasterSheet('SCHEDULED_5_MIN');
  console.log(JSON.stringify({event:'LIBRA_MASTER_AUTO_SYNC',version:snapshot.version,syncedAt:snapshot.syncedAt,stats:snapshot.stats,changes:snapshot.changes}));
};

export const config={schedule:'*/5 * * * *'};
