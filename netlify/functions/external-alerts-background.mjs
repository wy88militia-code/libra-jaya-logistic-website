import crypto from 'node:crypto';
import { processDueExternalAlerts } from './_external-alert-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

function token(){const secret=String(process.env.ADMIN_SESSION_SECRET||'');if(secret.length<32)throw new Error('ADMIN_SESSION_SECRET belum dikonfigurasi.');return crypto.createHmac('sha256',secret).update('libra:external-alerts:v1').digest('base64url');}
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}

export default async request=>{
  if(!safeEqual(request.headers.get('x-libra-alert-auth'),token()))return new Response('Forbidden',{status:403});
  try{
    const results=await processDueExternalAlerts(30),delivered=results.filter(r=>r.status==='DELIVERED').length,deadRows=results.filter(r=>r.status==='DEAD'),retry=results.filter(r=>r.status==='RETRY_PENDING').length;
    for(const row of deadRows){try{await createOperationalNotification({partnerId:row.partnerId||null,type:'EXTERNAL_ALERT_DEAD',severity:'CRITICAL',title:'Pengiriman alert eksternal gagal permanen',message:`Alert ${row.alertId} (${row.type}) gagal setelah ${row.attempts} attempt. Email: ${row.email?.status||'—'}; WhatsApp: ${row.whatsapp?.status||'—'}. Periksa Resilience & Alerts.`,reference:row.alertId,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-resilience',external:false,dedupeKey:`external-alert-dead:${row.alertId}`,metadata:{alertId:row.alertId,eventType:row.type,emailStatus:row.email?.status,whatsappStatus:row.whatsapp?.status}});}catch{}}
    await markSystemHeartbeat('ALERT_WORKER',{status:deadRows.length?'ERROR':'OK',message:`Processed ${results.length}; delivered ${delivered}; retry ${retry}; dead ${deadRows.length}.`,metadata:{processed:results.length,delivered,retry,dead:deadRows.length}});
    console.log(JSON.stringify({event:'LIBRA_EXTERNAL_ALERT_BATCH',processed:results.length,delivered,dead:deadRows.length,retry}));
  }catch(error){await markSystemHeartbeat('ALERT_WORKER',{status:'ERROR',message:String(error?.message||error)}).catch(()=>{});throw error;}
};
export const config={path:'/internal/external-alerts-background',background:true};
