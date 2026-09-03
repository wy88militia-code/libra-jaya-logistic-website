import crypto from 'node:crypto';
import { processDueExternalAlerts } from './_external-alert-core.mjs';

function token(){const secret=String(process.env.ADMIN_SESSION_SECRET||'');if(secret.length<32)throw new Error('ADMIN_SESSION_SECRET belum dikonfigurasi.');return crypto.createHmac('sha256',secret).update('libra:external-alerts:v1').digest('base64url');}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}

export default async request=>{
  if(!safeEqual(request.headers.get('x-libra-alert-auth'),token()))return new Response('Forbidden',{status:403});
  const results=await processDueExternalAlerts(30);const delivered=results.filter(r=>r.status==='DELIVERED').length,dead=results.filter(r=>r.status==='DEAD').length,retry=results.filter(r=>r.status==='RETRY_PENDING').length;
  console.log(JSON.stringify({event:'LIBRA_EXTERNAL_ALERT_BATCH',processed:results.length,delivered,dead,retry}));
};
export const config={path:'/internal/external-alerts-background',background:true};
