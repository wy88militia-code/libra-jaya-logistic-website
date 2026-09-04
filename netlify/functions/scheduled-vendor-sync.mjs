import { autoSyncVendorMaster } from './_vendor-master-core.mjs';

export default async ()=>{
  const snapshot=await autoSyncVendorMaster('SCHEDULED_10_MIN');
  console.log(JSON.stringify({event:'LIBRA_VENDOR_AUTO_SYNC',version:snapshot.version,syncedAt:snapshot.syncedAt,stats:snapshot.stats}));
};

export const config={schedule:'*/10 * * * *'};
