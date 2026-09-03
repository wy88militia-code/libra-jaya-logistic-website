import crypto from 'node:crypto';
import { scanSlaBookings, getSlaSummary } from './_sla-monitor-core.mjs';

function token(){const secret=String(process.env.ADMIN_SESSION_SECRET||'');if(secret.length<32)throw new Error('ADMIN_SESSION_SECRET belum dikonfigurasi.');return crypto.createHmac('sha256',secret).update('libra:sla-monitor:v1').digest('base64url');}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}

export default async request=>{
  if(!safeEqual(request.headers.get('x-libra-sla-auth'),token()))return new Response('Forbidden',{status:403});
  const rows=await scanSlaBookings(1800);const summary=await getSlaSummary();console.log(JSON.stringify({event:'LIBRA_SLA_MONITOR_COMPLETE',evaluated:rows.length,summary}));
};
export const config={path:'/internal/sla-monitor-background',background:true};
