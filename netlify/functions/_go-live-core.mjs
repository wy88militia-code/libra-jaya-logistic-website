import { accurateConfigStatus } from './_accurate-core.mjs';
import { backupPolicy, listBackups } from './_backup-core.mjs';
import { externalAlertConfig } from './_external-alert-core.mjs';
import { getMasterSnapshot, isSheetConfigured } from './_master-sheet-core.mjs';
import { offsiteBackupConfig } from './_offsite-backup-core.mjs';
import { listPartners } from './_partner-core.mjs';
import { privacyRetentionConfig } from './_privacy-retention-core.mjs';
import { listRatePlans } from './_rate-plan-core.mjs';
import { getVendorMaster, isVendorMasterConfigured } from './_vendor-master-core.mjs';

const bool=v=>Boolean(String(v||'').trim());
const now=()=>Date.now();
const ageHours=v=>{const t=new Date(v||0).getTime();return Number.isFinite(t)&&t>0?Math.round((now()-t)/360000)/10:null;};
function check(id,label,level,ok,detail,meta={}){return {id,label,level,status:ok?'PASS':level==='REQUIRED'?'BLOCKER':'WARNING',detail,...meta};}
export const DEVELOPMENT_SEQUENCE=[
 {no:1,name:'Courier Assignment + Chain of Custody',status:'CODE_UAT_READY'},
 {no:2,name:'Manifest Management',status:'CODE_UAT_READY'},
 {no:3,name:'Warehouse / Hub Scan',status:'CODE_UAT_READY'},
 {no:4,name:'Actual Weight & Reweigh',status:'CODE_UAT_READY'},
 {no:5,name:'Vendor Cost + Profitability',status:'CODE_UAT_READY'},
 {no:6,name:'Claims + Insurance Engine',status:'CODE_UAT_READY',note:'Coverage/policy wording final tetap bergantung dokumen polis.'},
 {no:7,name:'Accurate Online Production',status:'CODE_UAT_READY',note:'Actual production posting belum dianggap verified sebelum live proof.'},
 {no:8,name:'Customer Service + Ticketing',status:'CODE_UAT_READY'},
 {no:9,name:'Privacy, Retention & Device Security',status:'CODE_UAT_READY'},
];

export async function buildGoLiveReadiness(session=null){
 const [master,vendor,partners,ratePlans,backups]=await Promise.all([getMasterSnapshot().catch(()=>null),getVendorMaster().catch(()=>null),listPartners().catch(()=>[]),listRatePlans().catch(()=>[]),listBackups(20).catch(()=>[])]);
 const accurate=accurateConfigStatus(),alerts=externalAlertConfig(),offsite=offsiteBackupConfig(),privacy=privacyRetentionConfig(),backup=backupPolicy();
 const latestBackup=backups[0]||null,latestBackupAge=ageHours(latestBackup?.createdAt),activeRates=ratePlans.filter(x=>x.status==='ACTIVE'&&(x.rules||[]).some(r=>r.active!==false)).length,activePartners=partners.filter(x=>x.status==='ACTIVE').length;
 const xenditSecret=bool(process.env.XENDIT_SECRET_KEY),xenditWebhook=bool(process.env.XENDIT_WEBHOOK_TOKEN),partnerSecret=String(process.env.PARTNER_SESSION_SECRET||'').length>=32,adminSecret=String(process.env.ADMIN_SESSION_SECRET||'').length>=32;
 const checks=[
  check('ADMIN_DEVICE','Admin/Courier device-bound session','REQUIRED',Boolean(session?.deviceBound),'Session v2 harus cocok dengan signed HttpOnly device cookie.'),
  check('ADMIN_SECRET','Admin session secret','REQUIRED',adminSecret,'ADMIN_SESSION_SECRET minimal 32 karakter.'),
  check('PARTNER_SECRET','Partner session secret','REQUIRED',partnerSecret,'PARTNER_SESSION_SECRET minimal 32 karakter.'),
  check('GOOGLE_CONFIG','Google Master Sheet credential','REQUIRED',isSheetConfigured(),'Service account + Master Sheet ID tersedia tanpa membuka secret.'),
  check('MASTER_PUBLISHED','Master rute published','REQUIRED',Boolean(master?.status==='PUBLISHED'&&master?.routes?.length),master?`${master.stats?.totalRoutes??master.routes?.length??0} rute • version ${String(master.version||'').slice(0,12)}`:'Belum ada snapshot/current.'),
  check('VENDOR_CONFIG','Vendor Master credential','REQUIRED',isVendorMasterConfigured(),'Vendor Master memakai credential Google server-side.'),
  check('VENDOR_PUBLISHED','Vendor Master published','REQUIRED',Boolean(vendor?.status==='PUBLISHED'&&vendor?.rates?.length),vendor?`${vendor.stats?.vendors??vendor.vendors?.length??0} vendor • ${vendor.stats?.rates??vendor.rates?.length??0} rate`:'Belum ada Vendor Master published.'),
  check('RATE_PLAN','Rate plan aktif','REQUIRED',activeRates>0,`${activeRates} rate plan aktif dari ${ratePlans.length}.`),
  check('PARTNER_ACTIVE','Partner aktif untuk controlled live test','ADVISORY',activePartners>0,`${activePartners} partner aktif.`),
  check('XENDIT','Xendit server + webhook credential','REQUIRED',xenditSecret&&xenditWebhook,`Secret key ${xenditSecret?'ada':'belum'} • webhook token ${xenditWebhook?'ada':'belum'}.`),
  check('ACCURATE_AUTH','Accurate credential','REQUIRED',accurate.configured,`Auth mode: ${accurate.authMode}.`),
  check('ACCURATE_COA','Accurate COA mapping','REQUIRED',accurate.mappingReady,'Minimum Customer Deposit, Service Revenue, Claim Expense, Adjustment Expense.'),
  check('ACCURATE_POST_GATE','Accurate production posting gate','ADVISORY',accurate.postingEnabled,accurate.postingEnabled?'Gate aktif; tetap maker-checker.':'Gate masih terkunci; aman sampai live finance verification selesai.'),
  check('ALERT_CHANNEL','External admin alert channel','ADVISORY',alerts.email.configured||alerts.whatsapp.configured,`Email ${alerts.email.configured?'ready':'off'} • WhatsApp ${alerts.whatsapp.configured?'ready':'off'}.`),
  check('OFFSITE_CONFIG','Encrypted off-site backup','REQUIRED',offsite.configured,offsite.configured?'S3-compatible AES-256-GCM configured.':`Belum lengkap: ${(offsite.missing||[]).join(', ')}`),
  check('BACKUP_RECENT','Recent backup evidence','REQUIRED',latestBackupAge!==null&&latestBackupAge<=36,latestBackup?`${latestBackup.backupId} • ${latestBackupAge} jam lalu • offsite ${latestBackup.offsite?.status||'UNKNOWN'}`:'Belum ada backup.'),
  check('BACKUP_OFFSITE_EVIDENCE','Latest backup off-site evidence','ADVISORY',Boolean(latestBackup?.offsite&&['UPLOADED','IMPORTED'].includes(latestBackup.offsite.status)),latestBackup?.offsite?.status||'Belum ada bukti off-site pada backup terakhir.'),
  check('RETENTION_FAIL_CLOSED','Privacy retention fail-closed','REQUIRED',privacy.deleteEnabled===false,privacy.deleteEnabled?'Deletion gate sedang aktif — kunci kembali untuk cutover kecuali sedang maintenance.':'DRY_RUN_ONLY / deletion gate locked.'),
  check('BACKUP_COVERAGE','Critical backup policy coverage','REQUIRED',backup.protectedStores.includes('libra-claims')&&backup.protectedStores.includes('libra-tickets')&&backup.protectedStores.includes('libra-profitability'),'Claims, ticket, profitability dan data inti termasuk protected backup scope.'),
  check('MAPS','Google Maps enhanced geocoding/routing','ADVISORY',false,'Belum menjadi dependency core: GPS + kodeWilayah + geofence berjalan tanpa Maps. Routes/Geocoding tetap improvement terpisah.'),
 ];
 const required=checks.filter(x=>x.level==='REQUIRED'),blockers=required.filter(x=>x.status!=='PASS'),warnings=checks.filter(x=>x.status==='WARNING');
 const codeReady=DEVELOPMENT_SEQUENCE.every(x=>x.status==='CODE_UAT_READY');
 return {generatedAt:new Date().toISOString(),codeReady,productionVerified:false,goLiveDecision:blockers.length?'NOT_READY':'READY_FOR_CONTROLLED_LIVE_TEST',summary:{required:required.length,passed:required.length-blockers.length,blockers:blockers.length,warnings:warnings.length},checks,sequence:DEVELOPMENT_SEQUENCE,master:{version:master?.version||null,publishedAt:master?.publishedAt||null,routeCount:master?.routes?.length||0},vendor:{version:vendor?.version||null,publishedAt:vendor?.publishedAt||null,vendorCount:vendor?.vendors?.length||0,rateCount:vendor?.rates?.length||0},latestBackup:latestBackup?{backupId:latestBackup.backupId,createdAt:latestBackup.createdAt,ageHours:latestBackupAge,offsiteStatus:latestBackup.offsite?.status||null}:null,notes:['READY_FOR_CONTROLLED_LIVE_TEST bukan berarti produksi sudah verified.','Production Verified hanya setelah controlled E2E menggunakan bukti transaksi nyata dan rekonsiliasi selesai.','Tidak ada secret value yang dikembalikan dashboard.']};
}
