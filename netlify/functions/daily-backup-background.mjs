import crypto from 'node:crypto';
import { createBackup, pruneBackups } from './_backup-core.mjs';

function token(){const secret=String(process.env.ADMIN_SESSION_SECRET||'');if(secret.length<32)throw new Error('ADMIN_SESSION_SECRET belum dikonfigurasi.');return crypto.createHmac('sha256',secret).update('libra:scheduled-backup:v1').digest('base64url');}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}

export default async request=>{
  if(!safeEqual(request.headers.get('x-libra-backup-auth'),token()))return new Response('Forbidden',{status:403});
  const backup=await createBackup({kind:'SCHEDULED',actor:'system',reason:'Daily automated backup'});const retention=await pruneBackups();
  console.log(JSON.stringify({event:'LIBRA_DAILY_BACKUP_COMPLETE',backupId:backup.backupId,totalEntries:backup.totalEntries,totalBytes:backup.totalBytes,retention}));
};

export const config={path:'/internal/daily-backup-background',background:true};
