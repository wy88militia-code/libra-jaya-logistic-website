import { queueExternalAlert } from './_external-alert-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { getLatestSystemHealth, runSystemHealth } from './_system-health-core.mjs';

async function notify(previous,current){
  const changed=!previous||previous.overall!==current.overall||previous.issueFingerprint!==current.issueFingerprint;if(!changed)return;
  let input=null;
  if(current.overall==='HEALTHY'&&previous&&previous.overall!=='HEALTHY')input={type:'SYSTEM_HEALTH_RECOVERED',severity:'SUCCESS',title:'System Libra kembali normal',message:'Semua koneksi blocking yang dipantau kembali hijau. Accurate Full Auto ikut dinilai oleh System Health.'};
  else if(current.overall!=='HEALTHY'){
    const bad=current.checks.filter(x=>['WARN','FAIL'].includes(x.status)),list=bad.slice(0,5).map(x=>`${x.label}: ${x.status}`).join(' • ');
    input={type:'SYSTEM_HEALTH_ALERT',severity:current.overall==='CRITICAL'?'CRITICAL':'WARNING',title:current.overall==='CRITICAL'?'Gangguan koneksi sistem Libra':'System Libra perlu perhatian',message:`${list}${bad.length>5?` • +${bad.length-5} lainnya`:''}. Buka System Health untuk detail.`};
  }
  if(!input)return;
  const rows=await createOperationalNotification({...input,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-system-health',external:false,dedupeKey:`scheduled-health:${current.overall}:${current.issueFingerprint}:${current.checkedAt.slice(0,16)}`,metadata:{overall:current.overall,summary:current.summary,issueFingerprint:current.issueFingerprint}}).catch(()=>[]);
  for(const row of rows.filter(r=>r.audience==='admin'))await queueExternalAlert(row,{force:true}).catch(()=>{});
}

export default async ()=>{
  const previous=await getLatestSystemHealth().catch(()=>null),health=await runSystemHealth({emitNotifications:false,source:'SCHEDULED_10_MIN'});
  await notify(previous,health);
  console.log(JSON.stringify({event:'LIBRA_SYSTEM_HEALTH',overall:health.overall,summary:health.summary,issueFingerprint:health.issueFingerprint,checkedAt:health.checkedAt}));
};

export const config={schedule:'*/10 * * * *'};
