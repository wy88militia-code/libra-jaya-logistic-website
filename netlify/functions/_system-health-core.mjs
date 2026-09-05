import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { accurateAutoStatus, listAccurateAutoEvents } from './_accurate-auto-core.mjs';
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
const pilotSet=new Set(PILOT_ROUTE_CODES);
function fingerprint(checks){return crypto.createHash('sha256').update(checks.filter(x=>x.blocking!==false&&['WARN','FAIL'].includes(x.status)).map(x=>`${x.id}:${x.status}`).sort().join('|')).digest('hex').slice(0,16);}
function workerCheck(id,label,row,{pass=30,warn=60,link,missing='WARN',blocking=true}={}){
  if(!row)return check(id,label,missing,'Heartbeat belum tersedia. Worker akan dinilai setelah jadwal pertama berjalan.',{link,ageMinutes:null,blocking});
  const age=heartbeatAgeMinutes(row);
  if(row.status==='ERROR')return check(id,label,'FAIL',row.message||'Worker terakhir gagal.',{link,ageMinutes:age,meta:row.metadata,blocking});
  if(age===null)return check(id,label,'WARN','Waktu heartbeat tidak valid.',{link,blocking});
  if(age<=pass)return check(id,label,'PASS',row.message||`Terakhir berjalan ${age} menit lalu.`,{link,ageMinutes:age,meta:row.metadata,blocking});
  if(age<=warn)return check(id,label,'WARN',`Heartbeat terlambat: ${age} menit lalu. ${row.message||''}`.trim(),{link,ageMinutes:age,meta:row.metadata,blocking});
  return check(id,label,'FAIL',`Worker tidak memberi heartbeat selama ${age} menit.`,{link,ageMinutes:age,meta:row.metadata,blocking});
}
function countStatuses(rows){return rows.reduce((o,r)=>{const k=String(r?.status||'UNKNOWN').toUpperCase();o[k]=(o[k]||0)+1;return o;},{});}

export async function buildSystemHealth(){
  const checkedAt=now();
  const [master,lastMaster,vendor,lastVendor,sla,backups,hSla,hMin,hAlert,hBackup,hAccurate,hAi,accurateEvents]=await Promise.all([
    getMasterSnapshot().catch(()=>null),getLastMasterSync().catch(()=>null),getVendorMaster().catch(()=>null),getLastVendorSync().catch(()=>null),getSlaSummary().catch(()=>null),listBackups(5).catch(()=>[]),getSystemHeartbeat('SLA_MONITOR').catch(()=>null),getSystemHeartbeat('MINIMUM_LOAD').catch(()=>null),getSystemHeartbeat('ALERT_WORKER').catch(()=>null),getSystemHeartbeat('DAILY_BACKUP').catch(()=>null),getSystemHeartbeat('ACCURATE_AUTO').catch(()=>null),getSystemHeartbeat('AI_CONTROL_TOWER').catch(()=>null),listAccurateAutoEvents(200).catch(()=>[])
  ]);
  const maps=mapsConfigStatus(),alerts=externalAlertConfig(),offsite=offsiteBackupConfig(),accurate=accurateAutoStatus();
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
  const elevationEligible=pilot.filter(r=>!r.requiresOperationalConfirmation&&(r.autoVerified||String(r.statusKoordinat||'').includes('ROUTES PASS')||String(r.statusVerifikasi||'').includes('TERVERIFIKASI'))),elevationPass=elevationEligible.filter(r=>String(r.elevationStatus||r.elevationModelStatus||'').toUpperCase().includes('ELEVATION PASS')).length;
  if(!elevationEligible.length)checks.push(check('ELEVATION_TERRAIN','Elevation & Terrain','MANUAL','Belum ada rute darat terverifikasi yang wajib dihitung profil elevasinya. Modul ini opsional dan tidak memblokir operasional.',{link:'/admin-maps-pilot',blocking:false,meta:{eligible:0,pass:0,pending:0}}));
  else checks.push(check('ELEVATION_TERRAIN','Elevation & Terrain',elevationPass===elevationEligible.length?'PASS':'WARN',`${elevationPass}/${elevationEligible.length} rute darat terverifikasi memiliki profil elevasi.`,{link:'/admin-maps-pilot',blocking:false,meta:{eligible:elevationEligible.length,pass:elevationPass,pending:Math.max(0,elevationEligible.length-elevationPass)}}));

  const vendorAge=ageMin(lastVendor?.syncedAt||vendor?.syncedAt||vendor?.publishedAt);
  if(!isVendorMasterConfigured())checks.push(check('VENDOR_MASTER','Vendor Master & Cost','WARN','Credential Vendor Master belum lengkap. Operasional inti tetap dapat berjalan.',{link:'/admin-vendor-master',blocking:false}));
  else if(!vendor?.rates?.length)checks.push(check('VENDOR_MASTER','Vendor Master & Cost','PASS','Sheet Vendor terkoneksi. Pilot own-fleet dapat memakai Modal Rute Pilot.',{link:'/admin-vendor-master',blocking:false,meta:{mode:'OWN_FLEET_PILOT',vendors:vendor?.vendors?.length||0,rates:0}}));
  else if(lastVendor?.status&&lastVendor.status!=='OK')checks.push(check('VENDOR_MASTER','Vendor Master & Cost','WARN',`Sync vendor terakhir ${lastVendor.status}. Snapshot lama tetap dipakai.`,{link:'/admin-vendor-master',ageMinutes:vendorAge,blocking:false}));
  else if(vendorAge===null||vendorAge>35)checks.push(check('VENDOR_MASTER','Vendor Master & Cost','WARN',`Vendor sync terakhir ${vendorAge===null?'belum tercatat':`${vendorAge} menit lalu`}.`,{link:'/admin-vendor-master',ageMinutes:vendorAge,blocking:false}));
  else checks.push(check('VENDOR_MASTER','Vendor Master & Cost','PASS',`${vendor.vendors?.length||0} vendor • ${vendor.rates?.length||0} rate • sync ${vendorAge} menit lalu.`,{link:'/admin-vendor-master',ageMinutes:vendorAge,blocking:false}));

  const xSecret=Boolean(String(process.env.XENDIT_SECRET_KEY||'').trim()),xWebhook=Boolean(String(process.env.XENDIT_WEBHOOK_TOKEN||'').trim());
  if(xSecret&&xWebhook)checks.push(check('XENDIT','Xendit Deposit & Webhook','PASS','Xendit secret + webhook token terkonfigurasi.',{link:'/admin-partners',blocking:false}));
  else if(xSecret||xWebhook)checks.push(check('XENDIT','Xendit Deposit & Webhook','WARN',`Konfigurasi parsial: secret ${xSecret?'OK':'BELUM'} • webhook ${xWebhook?'OK':'BELUM'}. Deposit manual bank tetap tersedia.`,{link:'/admin-partners',blocking:false}));
  else checks.push(check('XENDIT','Xendit Deposit & Webhook','MANUAL','Belum diaktifkan. Deposit manual bank + maker-checker adalah jalur resmi saat ini.',{link:'/admin-partners',blocking:false}));

  const emailReady=Boolean(alerts.email?.configured&&alerts.email?.adminRecipients>0),waReady=Boolean(alerts.whatsapp?.configured&&alerts.whatsapp?.adminRecipients>0);
  if(emailReady&&waReady)checks.push(check('ALERT_CHANNELS','Email / WhatsApp Alert','PASS','Email + WhatsApp alert eksternal siap.',{link:'/admin-resilience',blocking:false}));
  else if(emailReady||waReady)checks.push(check('ALERT_CHANNELS','Email / WhatsApp Alert','WARN',`Email ${emailReady?'OK':'BELUM'} • WhatsApp ${waReady?'OK':'BELUM'}. Notifikasi internal tetap aktif.`,{link:'/admin-resilience',blocking:false}));
  else checks.push(check('ALERT_CHANNELS','Email / WhatsApp Alert','MANUAL','Alert eksternal belum diaktifkan; notifikasi internal Super Admin tetap tersedia.',{link:'/admin-resilience',blocking:false}));
  checks.push(workerCheck('ALERT_WORKER','Alert Delivery Worker',hAlert,{pass:5,warn:12,link:'/admin-resilience',blocking:false}));
  checks.push(workerCheck('SLA_MONITOR','SLA Monitor Worker',hSla,{pass:35,warn:65,link:'/admin-sla-control'}));
  checks.push(workerCheck('MINIMUM_LOAD','Minimum Load Worker',hMin,{pass:35,warn:65,link:'/admin-consolidation'}));
  checks.push(workerCheck('ACCURATE_AUTO_WORKER','Accurate Auto Worker',hAccurate,{pass:8,warn:15,link:'/admin-accurate/auto'}));
  checks.push(workerCheck('AI_CONTROL_TOWER','AI Control Tower',hAi,{pass:90,warn:180,link:'/admin-ai-control-tower',blocking:false}));

  const latestBackup=backups?.[0]||null,backupAge=ageMin(latestBackup?.createdAt);
  if(hBackup)checks.push(workerCheck('DAILY_BACKUP','Daily Backup',hBackup,{pass:30*60,warn:48*60,link:'/admin-audit-backup'}));
  else if(latestBackup&&backupAge!==null&&backupAge<=30*60)checks.push(check('DAILY_BACKUP','Daily Backup','PASS',`${latestBackup.backupId} • ${Math.round(backupAge/60*10)/10} jam lalu.`,{link:'/admin-audit-backup',ageMinutes:backupAge}));
  else checks.push(check('DAILY_BACKUP','Daily Backup','WARN','Heartbeat backup belum tersedia atau backup terakhir terlalu lama.',{link:'/admin-audit-backup'}));
  checks.push(check('OFFSITE_BACKUP','Encrypted Off-site Backup',offsite.configured?'PASS':'MANUAL',offsite.configured?'Konfigurasi off-site terenkripsi tersedia.':`Opsional / belum diaktifkan. Belum lengkap: ${(offsite.missing||[]).join(', ')||'konfigurasi belum siap'}. Backup utama tetap dipantau terpisah.`,{link:'/admin-resilience',blocking:false}));

  const adminSecret=String(process.env.ADMIN_SESSION_SECRET||'').length>=32,partnerSecret=String(process.env.PARTNER_SESSION_SECRET||'').length>=32,origin=Boolean(String(process.env.URL||process.env.DEPLOY_PRIME_URL||'').trim());
  checks.push(check('API_SECURITY','Partner API & Security',adminSecret&&partnerSecret?'PASS':'FAIL',`Admin session ${adminSecret?'OK':'BELUM'} • Partner/API session ${partnerSecret?'OK':'BELUM'}.`,{link:'/admin-api-security'}));
  checks.push(check('NETLIFY_RUNTIME','Netlify Runtime',origin?'PASS':'FAIL',origin?'Runtime origin tersedia untuk worker internal.':'URL/DEPLOY_PRIME_URL belum tersedia.',{link:'/admin-go-live'}));
  checks.push(check('SLA_STATE','SLA Operational State',sla?.error?'WARN':'PASS',sla?`Aktif ${sla.active||0} • RED ${sla.red||0} • YELLOW ${sla.yellow||0} • error ${sla.error||0}.`:'Belum ada data SLA.',{link:'/admin-sla-control',blocking:false,meta:sla}));

  const accCounts=countStatuses(accurateEvents),accReady=accurate.enabled&&accurate.postingEnabled&&accurate.productionArmed&&accurate.startAtValid;
  const accReconcile=accCounts.RECONCILE_REQUIRED||0,accFailed=accCounts.POST_FAILED||0,accException=accCounts.EXCEPTION||0,accRetry=accCounts.RETRY||0,accPosted=accCounts.POSTED||0;
  if(!accReady)checks.push(check('ACCURATE','Accurate Online Full Auto','FAIL',`Full Auto ${accurate.enabled?'ON':'OFF'} • Posting ${accurate.postingEnabled?'ON':'OFF'} • Armed ${accurate.productionArmed?'ON':'OFF'} • Start ${accurate.startAtValid?'VALID':'INVALID'}.`,{link:'/admin-accurate/auto',meta:{...accurate,counts:accCounts}}));
  else if(accReconcile||accFailed)checks.push(check('ACCURATE','Accurate Online Full Auto','FAIL',`POSTED ${accPosted} • Reconcile ${accReconcile} • Failed ${accFailed} • Exception ${accException}. Transaksi bermasalah harus diperiksa sebelum retry.`,{link:'/admin-accurate/auto',meta:{...accurate,counts:accCounts}}));
  else if(accException||accRetry)checks.push(check('ACCURATE','Accurate Online Full Auto','WARN',`Full Auto aktif • POSTED ${accPosted} • Retry ${accRetry} • Exception ${accException}.`,{link:'/admin-accurate/auto',blocking:false,meta:{...accurate,counts:accCounts}}));
  else checks.push(check('ACCURATE','Accurate Online Full Auto','PASS',`Full Auto ON • 2/2 production lock aktif • Duplicate Guard + Read-back ON • POSTED ${accPosted}.`,{link:'/admin-accurate/auto',meta:{...accurate,counts:accCounts}}));

  const blockingWarnings=checks.filter(x=>x.blocking!==false&&x.status==='WARN').length,blockingFail=checks.filter(x=>x.blocking!==false&&x.status==='FAIL').length,warnings=checks.filter(x=>x.status==='WARN').length,failures=checks.filter(x=>x.status==='FAIL').length,passes=checks.filter(x=>x.status==='PASS').length,manual=checks.filter(x=>x.status==='MANUAL').length;
  const advisoryWarnings=checks.filter(x=>x.blocking===false&&['WARN','FAIL'].includes(x.status)).length;
  const overall=blockingFail?'CRITICAL':blockingWarnings?'DEGRADED':'HEALTHY',issueFingerprint=fingerprint(checks);
  return {checkedAt,overall,issueFingerprint,summary:{total:checks.length,passes,warnings,failures,manual,blockingWarnings,blockingFail,advisoryWarnings},checks};
}

async function notifyTransition(previous,current){
  const changed=!previous||previous.overall!==current.overall||previous.issueFingerprint!==current.issueFingerprint;if(!changed)return null;
  const bad=current.checks.filter(x=>x.blocking!==false&&['WARN','FAIL'].includes(x.status));
  if(current.overall==='HEALTHY'&&previous&&previous.overall!=='HEALTHY')return createOperationalNotification({type:'SYSTEM_HEALTH_RECOVERED',severity:'SUCCESS',title:'System Libra kembali normal',message:'Semua koneksi blocking yang dipantau kembali dalam kondisi hijau.',notifyPartner:false,notifyAdmin:true,adminLink:'/admin-system-health',dedupeKey:`system-health:recovered:${current.checkedAt.slice(0,16)}`,metadata:{overall:current.overall,summary:current.summary}});
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
