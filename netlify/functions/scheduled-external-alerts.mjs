import crypto from 'node:crypto';
function authToken(){const secret=String(process.env.ADMIN_SESSION_SECRET||'');if(secret.length<32)throw new Error('ADMIN_SESSION_SECRET belum dikonfigurasi.');return crypto.createHmac('sha256',secret).update('libra:external-alerts:v1').digest('base64url');}
export default async ()=>{const origin=String(process.env.URL||process.env.DEPLOY_PRIME_URL||'').replace(/\/$/,'');if(!origin)throw new Error('Netlify URL environment belum tersedia.');const response=await fetch(`${origin}/internal/external-alerts-background`,{method:'POST',headers:{'x-libra-alert-auth':authToken()}});if(!response.ok)throw new Error(`External alert worker gagal dijadwalkan: HTTP ${response.status}.`);};
export const config={schedule:'* * * * *'};
