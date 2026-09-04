import { autoSyncVendorMaster } from './_vendor-master-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

export default async ()=>{
  try{
    const snapshot=await autoSyncVendorMaster('SCHEDULED_10_MIN');
    await markSystemHeartbeat('VENDOR_SYNC',{status:'OK',message:`Vendor Master ${snapshot.stats?.vendors||0} vendor / ${snapshot.stats?.rates||0} rate tersinkron.`,metadata:{version:snapshot.version,syncedAt:snapshot.syncedAt,stats:snapshot.stats}});
    console.log(JSON.stringify({event:'LIBRA_VENDOR_AUTO_SYNC',version:snapshot.version,syncedAt:snapshot.syncedAt,stats:snapshot.stats}));
  }catch(error){await markSystemHeartbeat('VENDOR_SYNC',{status:'ERROR',message:String(error?.message||error)}).catch(()=>{});throw error;}
};

export const config={schedule:'*/10 * * * *'};
