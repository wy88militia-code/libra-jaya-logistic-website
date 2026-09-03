import { createBackup, pruneBackups } from './_backup-core.mjs';

export default async ()=>{
  const backup=await createBackup({kind:'SCHEDULED',actor:'system',reason:'Daily automated backup'});const retention=await pruneBackups();
  return new Response(JSON.stringify({ok:true,backupId:backup.backupId,totalEntries:backup.totalEntries,totalBytes:backup.totalBytes,retention}),{headers:{'content-type':'application/json'}});
};

// 17:15 UTC = 02:15 WIT hari berikutnya.
export const config={schedule:'15 17 * * *'};
