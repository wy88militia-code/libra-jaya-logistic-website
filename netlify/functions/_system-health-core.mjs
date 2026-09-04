import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { listBackups } from './_backup-core.mjs';
import { externalAlertConfig } from './_external-alert-core.mjs';
import { mapsConfigStatus } from './_maps-core.mjs';
import { getLastMasterSync, getMasterSnapshot, isSheetConfigured } from './_master-sheet-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { offsiteBackupConfig } from './_offsite-backup-core.mjs';
import { PILOT_ROUTE_CODES } from './_pilot-geocode-core.mjs';
import { getSlaSummary } from './_sla-monitor-core.mjs';
import { getSystemHeartbeat, heartbeatAgeMinutes } from './_system-heartbeat-core.mjs';
import { getLastVendorSync, getVendorMaster, isVendorMasterConfigured } from './_vendor-master-core.mjs';

const STORE='libra-system-health';
const CURRENT='health/current';
const HISTORY='health/history/';
const store=()=>getStore(STORE);
const now=()=>new Date().toISOString();
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const ageMin=v=>{const t=new Date(v||0).getTime();return Number.isFinite(t)&&t>0?Math.round((Date.now()-t)/6000)/10:null;};
const check=(id,label,status,detail,{link='/admin-tool',ageMinutes=null,blocking=true,meta=null}={})=>({id,label,status,detail,link,ageMinutes,blocking,meta});
const statusRank={PASS:0,MANUAL:0,WARN:1,FAIL:2};
const pilotSet=new Set(PILOT_ROUTE_CODES);
function fingerprint(checks){return crypto.createHash('sha256').update(checks.filter(x=>['WARN','FAIL'].includes(x.status)).map(x=>`${x.id}:${x.status}`).sort().join('|')).digest('hex').slice(0,16);}
function workerCheck(id,label,row,{pass=30,warn=60,link,missing='WARN'}={}){
  if(!row)return check(id,label,missing,`Heartbeat belum tersedia. Worker akan dinilai setelah jadwal pertama berjalan.`,{link,ageMinutes:null});
  const age=heartbeatAgeMinutes(row);if(row.status==='ERROR')return check(id,label,'FAIL',row.message||'Worker terakhir gagal.',{link,ageMinutes:age,meta:row.metadata});
  if(age===null)return check(id,label,'WARN','Waktu heartbeat tidak valid.',{link});
  if(age<=pass)return check(id,label,'PASS',row.message||`Terakhir berjalan ${age} menit lalu.`,{link,ageMinutes:age,meta:row.metadata});
  if(age<=warn)return check(id,label,'WARN',`Heartbeat terlambat: ${age} menit lalu. ${row.message||''}`.trim(),{link,ageMinutes:age,meta:row.metadata});
  return check(id,label,'FAIL',`Worker tidak memberi heartbeat selama ${age} menit.`,{link,ageMinutes:age,meta:row.metadata});
}

export async function buildSystemHealth(){
  const checkedAt=now();
  const [master,lastMaster,vendor,lastVendor,sla,backups,hSla,hMin,hAlert,hBackup]=await Promise.all([
    getMasterSnapshot().catch(()=>null),getLastMasterSync().catch(()=>null),getVendorMaster().catch(()=>null),getLastVendorSync().catch(()=>null),getSlaSummary().catch(()=>null),listBackups(5).catch(()=>[]),getSystemHeartbeat('SLA_MONITOR').catch(()=>null),getSystemHeartbeat('MINIMUM_LOAD').catch(()=>null),getSystemHeartbeat('ALERT_WORKER').catch(()=>null),getSystemHeartbeat('DAILY_BACKUP').catch(()=>null)
  ]);
  const maps=mapsConfigStatus(),alerts=externalAlertConfig(),offsite=offsiteBackupConfig();
  const checks=[];

  const masterAge=ageMin(lastMaster?.syncedAt||master?.syncedAt);
  if(!isSheetConfigured())checks.push(check('MASTER_SHEET','Google Master Sheet','FAIL','Credential Google Sheet belum lengkap.',{link:'/admin-master-sheet'}));
  else if(!master?.routes?.length)checks.push(check('MASTER_SHEET','Google Master Sheet','FAIL','Belum ada snapshot Master operasional.',{link:'/admin-master-sheet'}));
  else if(lastMaster?.status&&lastMaster.status!=='OK')checks.push(check('MASTER_SHEET','Google Master Sheet','FAIL',`Sync terakhir ${lastMaster.status}: ${(lastMaster.errors||[]).slice(0,2).join(' | ')||'periksa Master.'}`,{link:'/admin-master-sheet',ageMinutes:masterAge}));
  else if(masterAge===null||masterAge>20)checks.push(check('MASTER_SHEET','Google Master Sheet',masterAge!==null&&masterAge<=40?'WARN':'FAIL',`Auto-sync terakhir ${masterAge===null?'belum tercatat':`${masterAge} menit lalu`}.`,{link:'/admin-master-sheet',ageMinutes:masterAge}));
  else checks.push(check('MASTER_SHEET','Google Master Sheet','PASS',`${master.routes.length} rute terbaca • sync ${masterAge} menit lalu.`,{link:'/admin-master-sheet',ageMinutes:masterAge,meta:{version:master.version,stats:master.stats}}));

  const routes=master?.routes||[],pilot=routes.filter(r=>pilotSet.has(String(r.kodeRute||''))),verified=pilot.filter(r=>r.autoVerified||String(r.statusKoordinat||'').includes('ROUTES PASS')||String(r.statusVerifikasi||'').includes('TERVERIFIKASI')).length,confirmation=pilot.filter(r=>r.requiresOperationalConfirmation).length,autoPriced=pilot.filter(r=>num(r.tarifRekomKg)>0).length;
  if(!maps.serverConfigured&&!maps.browserConfigured)checks.push(check('GOOGLE_MAPS','Google Maps & Routes','FAIL','Server key dan browser key belum terkonfigurasi.',{link:'/admin-maps-pilot'}));
  else if(!maps.serverConfigured||!maps.browserConfigured)checks.push(check('GOOGLE_MAPS','Google Maps & Routes','WARN',`Server ${maps.serverConfigured?'OK':'BELUM'} • Browser ${maps.browserConfigured?'OK':'BELUM'}.`,{link:'/admin-maps-pilot'}));
  else checks.push(check('GOOGLE_MAPS','Google Maps & Routes','PASS','Server API key + Browser API key terkonfigurasi.',{link:'/admin-maps-pilot'}));
  const pilotReady=pilot.length===PILOT_ROUTE_CODES.length&&verified+confirmation>=PILOT_ROUTE_CODES.length&&verified>=PILOT_ROUTE_CODES.length-confirmation;
  checks.push(check('PILOT_ROUTES','41 Rute Pilot',pilotReady?'PASS':'WARN',`${pilot.length}/${PILOT_ROUTE_CODES.length} ada di Master • ${verified} Routes terverifikasi • ${confirmation} konfirmasi operasional • ${autoPriced} punya harga rekomendasi.`,{link:'/admin-maps-pilot',blocking:false,meta:{pilot:pilot.length,verified,confirmation,autoPriced}}));

  const vendorAge=ageMin(lastVendor?.syncedAt||vendor?.syncedAt||vendor?.publishedAt);
  if(!isVendorMasterConfigured())checks.push(check('VENDOR_MASTER','Vendor Master & Cost','WARN','Credential Vendor Master belum lengkap. Operasional inti tetap dapat berjalan, tetapi expected cost/profitability tidak lengkap.',{link:'/admin-vendor-master',blocking:false}));
  else if(!vendor?.rates?.length)checks.push(check('VENDOR_MASTER','Vendor Master & Cost','WARN','Belum ada snapshot rate vendor aktif.',{link:'/admin-vendor-master',blocking:false}));
  else if(lastVendor?.status&&lastVendor.status!=='OK')checks.push(check('VENDOR_MASTER','Vendor Master & Cost','WARN',`Sync vendor terakhir ${lastVendor.status}. Snapshot lama tetap dipakai.`,{link:'/admin-vendor-master',ageMinutes:vendorAge,blocking:false}));
  else if(vendorAge===null||vendorAge>35)checks.push(check('VENDOR_MASTER','Vendor Master & Cost','WARN',`Vendor sync terakhir ${vendorAge===null?'belum tercatat':`${vendorAge} menit lalu`}.`,{link:'/admin-vendor-master',ageMinutes:vendorAge,blocking:false}));
  else checks.push(check('VENDOR_MASTER','Vendor Master & Cost','PASS',`${vendor.vendors?.length||0} vendor • ${vendor.rates?.length||0} rate • sync ${vendorAge} menit lalu.`,{link:'/admin-vendor-master',ageMinutes:vendorAge,blocking:false}));

  const xSecret=Boolean(String(process.env.XENDIT_SECRET_KEY||'').trim()),xWebhook=Boolean(String(process.env.XENDIT_WEBHOOK_TOKEN||'').trim());
  checks.push(check('XENDIT','Xendit Deposit & Webhook',xSecret&&xWebhook?'PASS':'FAIL',`Secret key ${xSecret?'OK':'BELUM'} • webhook token ${xWebhook?'OK':'BELUM'}.`,{link:'/admin-partners'}));

  const emailReady=Boolean(alerts.email?.configured&&alerts.email?.adminRecipients>0),waReady=Boolean(alerts.whatsapp?.configured&&alerts.whatsapp?.adminRecipients>0);
  checks.push(check('ALERT_CHANNELS','Email / WhatsApp Alert',emailReady&&waReady?'PASS':emailReady||waReady?'WARN':'FAIL',`Email ${emailReady?'OK':'BELUM'} • WhatsApp ${waReady?'OK':'BELUM'}.`,{link:'/admin-resilience'}));
  checks.push(workerCheck('ALERT_WORKER','Alert Delivery Worker',hAlert,{pass:5,warn:12,link:'/admin-resilience'}));
  checks.push(workerCheck('SLA_MONITOR','SLA Monitor Worker',hSla,{pass:35,warn:65,link:'/admin-sla-control'}));
  checks.push(workerCheck('MINIMUM_LOAD','Minimum Load Worker',hMin,{pass:35,warn:65,link:'/admin-consolidation'}));

  const latestBackup=backups?.[0]||null,backupAge=ageMin(latestBackup?.createdAt);
  if(hBackup)checks.push(workerCheck('DAILY_BACKUP','Daily Backup',hBackup,{pass:30*60,warn:48*60,link:'/admin-audit-backup'}));
  else if(latestBackup&&backupAge!==null&&backupAge<=30*60)checks.push(check('DAILY_BACKUP','Daily Backup','PASS',`${latestBackup.backupId} • ${Math.round(backupAge/60*10)/10} jam lalu.`,{link:'/admin-audit-backup',ageMinutes:backupAge}));
  else checks.push(check('DAILY_BACKUP','Daily Backup','WARN','Heartbeat backup belum tersedia atau backup terakhir terlalu lama.',{link:'/admin-audit-backup'}));
  checks.push(check('OFFSITE_BACKUP','Encrypted Off-site Backup',offsite.configured?'PASS':'WARN',offsite.configured?'Konfigurasi off-site terenkripsi tersedia.':`Belum lengkap: ${(offsite.missing||[]).join(', ')||'konfigurasi belum siap'}.`,{link:'/admin-resilience',blocking:false}));

  const adminSecret=String(process.env.ADMIN_SESSION_SECRET||'').length>=32,partnerSecret=String(process.env.PARTNER_SESSION_SECRET||'').length>=32,origin=Boolean(String(process.env.URL||process.env.DEPLOY_PRIME_URL||'').trim());
  checks.push(check('API_SECURITY','Partner API & Security',adminSecret&&partnerSecret?'PASS':'FAIL',`Admin session ${adminSecret?'OK':'BELUM'} • Partner/API session ${partnerSecret?'OK':'BELUM'}.`,{link:'/admin-api-security'}));
  checks.push(check('NETLIFY_RUNTIME','Netlify Runtime',origin?'PASS':'FAIL',origin?'Runtime origin tersedia untuk worker internal.':'URL/DEPLOY_PRIME_URL belum tersedia.',{link:'/admin-go-live'}));
  checks.push(check('SLA_STATE','SLA Operational State',sla?.error?'WARN':'PASS',sla?`Aktif ${sla.active||0} • RED ${sla.red||0} • YELLOW ${sla.yellow||0} • error ${sla.error||0}.`:'Belum ada data SLA.',{link:'/admin-sla-control',blocking:false,meta:sla}));
  checks.push(check('ACCURATE','Accurate Online','MANUAL','Manual / belum diaktifkan. Tidak mempengaruhi status koneksi operasional lain.',{link:'/admin-accurate',blocking:false}));

  const blockingFail=checks.filter(x=>x.blocking!==false&&x.status==='FAIL').length,warnings=checks.filter(x=>x.status==='WARN').length,failures=checks.filter(x=>x.status==='FAIL').length,passes=checks.filter(x=>x.status==='PASS').length,manual=checks.filter(x=>x.status==='MANUAL').length;
  const overall=blockingFail?'CRITICAL':warnings||failures?'DEGRADED':'HEALTHY',issueFingerprint=fingerprint(checks);
  return {checkedAt,overall,issueFingerprint,summary:{total:checks.length,passes,warnings,failures,manual,blockingFail},checks};
}

async function notifyTransition(previous,current){
  const changed=!previous||previous.overall!==current.overall||previous.issueFingerprint!==current.issueFingerprint;if(!changed)return null;
  const bad=current.checks.filter(x=>['WARN','FAIL'].includes(x.status));
  if(current.overall==='HEALTHY'&&previous&&previous.overall!=='HEALTHY')return createOperationalNotification({type:'SYSTEM_HEALTH_RECOVERED',severity:'SUCCESS',title:'System Libra kembali normal',message:'Semua koneksi operasional yang dipantau kembali dalam kondisi hijau. Accurate tetap manual/non-blocking.',notifyPartner:false,notifyAdmin:true,adminLink:'/admin-system-health',dedupeKey:`system-health:recovered:${current.checkedAt.slice(0,16)}`,metadata:{overall:current.overall,summary:current.summary}});
  if(current.overall==='HEALTHY')return null;
  const severity=current.overall==='CRITICAL'?'CRITICAL':'WARNING',list=bad.slice(0,5).map(x=>`${x.label}: ${x.status}`).join(' • ');
  return createOperationalNotification({type:'SYSTEM_HEALTH_ALERT',severity,title:current.overall==='CRITICAL'?'Gangguan koneksi sistem Libra':'System Libra perlu perhatian',message:`${list}${bad.length>5?` • +${bad.length-5} lainnya`:''}. Buka System Health untuk detail.`,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-system-health',dedupeKey:`system-health:${current.overall}:${current.issueFingerprint}:${current.checkedAt.slice(0,16)}`,metadata:{overall:current.overall,issueFingerprint:current.issueFingerprint,summary:current.summary,issues:bad.map(x=>({id:x.id,status:x.status,detail:x.detail}))}});
}

export async function runSystemHealth({emitNotifications=true,source='SYSTEM'}={}){
  const previous=await store().get(CURRENT,{type:'json',consistency:'strong'}),built=await buildSystemHealth(),snapshot={...built,source};
  await store().setJSON(CURRENT,snapshot);await store().setJSON(`${HISTORY}${snapshot.checkedAt}-${snapshot.issueFingerprint}`,snapshot,{onlyIfNew:true}).catch(()=>{});
  if(emitNotifications)try{await notifyTransition(previous,snapshot);}catch{}
  return snapshot;
}
export async function getLatestSystemHealth(){return store().get(CURRENT,{type:'json',consistency:'strong'});}
