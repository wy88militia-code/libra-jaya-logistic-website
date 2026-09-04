import crypto from 'node:crypto';
import { createBackup, pruneBackups } from './_backup-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { offsiteBackupConfig, uploadOffsiteBackup } from './_offsite-backup-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

function token(){const secret=String(process.env.ADMIN_SESSION_SECRET||'');if(secret.length<32)throw new Error('ADMIN_SESSION_SECRET belum dikonfigurasi.');return crypto.createHmac('sha256',secret).update('libra:scheduled-backup:v1').digest('base64url');}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}

export default async request=>{
  if(!safeEqual(request.headers.get('x-libra-backup-auth'),token()))return new Response('Forbidden',{status:403});
  let backup;
  try{backup=await createBackup({kind:'SCHEDULED',actor:'system',reason:'Daily automated backup'});}catch(error){await markSystemHeartbeat('DAILY_BACKUP',{status:'ERROR',message:String(error?.message||error)}).catch(()=>{});try{await createOperationalNotification({type:'BACKUP_FAILED',severity:'CRITICAL',title:'Backup harian Libra gagal',message:`Backup internal Netlify Blobs gagal: ${String(error?.message||error).slice(0,500)}`,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-audit-backup',dedupeKey:`backup-failed:${new Date().toISOString().slice(0,10)}`});}catch{}throw error;}
  const retention=await pruneBackups();const offsiteCfg=offsiteBackupConfig();let offsite={status:'NOT_CONFIGURED'};
  if(offsiteCfg.configured){try{offsite=await uploadOffsiteBackup(backup);}catch(error){offsite={status:'FAILED',error:String(error?.message||error).slice(0,500)};try{await createOperationalNotification({type:'BACKUP_OFFSITE_FAILED',severity:'CRITICAL',title:'Off-site backup Libra gagal',message:`Backup ${backup.backupId} tersimpan internal, tetapi salinan terenkripsi off-site gagal: ${offsite.error}`,reference:backup.backupId,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-resilience',dedupeKey:`offsite-backup-failed:${backup.backupId}`,metadata:{backupId:backup.backupId}});}catch{}}}
  await markSystemHeartbeat('DAILY_BACKUP',{status:offsite.status==='FAILED'?'ERROR':'OK',message:offsite.status==='FAILED'?`Backup internal OK, off-site gagal: ${offsite.error}`:`Backup ${backup.backupId} selesai; off-site ${offsite.status}.`,metadata:{backupId:backup.backupId,totalEntries:backup.totalEntries,totalBytes:backup.totalBytes,retention,offsite}});
  console.log(JSON.stringify({event:'LIBRA_DAILY_BACKUP_COMPLETE',backupId:backup.backupId,totalEntries:backup.totalEntries,totalBytes:backup.totalBytes,retention,offsite}));
};
export const config={path:'/internal/daily-backup-background',background:true};
