import crypto from 'node:crypto';

function authToken(){const secret=String(process.env.ADMIN_SESSION_SECRET||'');if(secret.length<32)throw new Error('ADMIN_SESSION_SECRET belum dikonfigurasi.');return crypto.createHmac('sha256',secret).update('libra:scheduled-backup:v1').digest('base64url');}

export default async ()=>{
  const origin=String(process.env.URL||process.env.DEPLOY_PRIME_URL||'').replace(/\/$/,'');if(!origin)throw new Error('Netlify URL environment belum tersedia.');
  const response=await fetch(`${origin}/internal/daily-backup-background`,{method:'POST',headers:{'x-libra-backup-auth':authToken()}});if(!response.ok)throw new Error(`Background backup gagal dijadwalkan: HTTP ${response.status}.`);
  console.log(JSON.stringify({event:'LIBRA_DAILY_BACKUP_QUEUED',status:response.status}));
};

// 17:15 UTC = 02:15 WIT hari berikutnya. Scheduled function hanya mengantrekan background worker.
export const config={schedule:'15 17 * * *'};
