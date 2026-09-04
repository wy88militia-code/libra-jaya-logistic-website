import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const STORE_NAME='libra-master-sync';
const CURRENT_KEY='snapshot/current';
const PENDING_KEY='snapshot/pending';
const LAST_SYNC_KEY='sync/last';
const AUTO_MIN_CHARGE_KG=10;

function base64url(value){return Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');}
function normalizePrivateKey(value){return String(value||'').replace(/\\n/g,'\n').trim();}
function cell(row,index){return row?.[index]??'';}
function upper(value){return String(value||'').trim().toUpperCase();}
function text(value){return String(value??'').trim();}
function numberOrNull(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  let normalized=String(value??'').trim().replace(/\s/g,'');
  if(!normalized)return null;
  normalized=normalized.replace(/[^0-9,.-]/g,'');
  if(!normalized)return null;
  if(normalized.includes(',')&&normalized.includes('.')){
    const lastComma=normalized.lastIndexOf(','),lastDot=normalized.lastIndexOf('.');
    if(lastComma>lastDot)normalized=normalized.replace(/\./g,'').replace(',','.');
    else normalized=normalized.replace(/,/g,'');
  }else if(normalized.includes(',')){
    const parts=normalized.split(',');
    normalized=parts.length===2&&parts[1].length<=2?`${parts[0]}.${parts[1]}`:parts.join('');
  }
  const number=Number(normalized);
  return Number.isFinite(number)?number:null;
}
function boolText(value,needle){return upper(value).includes(upper(needle));}
function parseDurationHours(value){
  const s=String(value||'').toLowerCase().replace(/,/g,'.');if(!s)return null;
  let total=0,found=false;const h=s.match(/(\d+(?:\.\d+)?)\s*(?:jam|hour|hours|hr|hrs)/);if(h){total+=Number(h[1]);found=true;}
  const m=s.match(/(\d+(?:\.\d+)?)\s*(?:menit|minute|minutes|min)/);if(m){total+=Number(m[1])/60;found=true;}
  if(!found){const n=Number(s.replace(/[^0-9.]/g,''));if(Number.isFinite(n)&&n>0)return n;return null;}
  return total>0?total:null;
}
function roundUp(value,step=2){return Math.ceil(Math.max(0,Number(value)||0)/step)*step;}

export function sheetConfig(){
  return {
    sheetId:process.env.MASTER_SHEET_ID||DEFAULT_SHEET_ID,
    serviceEmail:String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL||'').trim(),
    privateKey:normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
  };
}
export function isSheetConfigured(){const config=sheetConfig();return Boolean(config.sheetId&&config.serviceEmail&&config.privateKey);}

async function getGoogleAccessToken(){
  const {serviceEmail,privateKey}=sheetConfig();
  if(!serviceEmail||!privateKey)throw new Error('Google Service Account belum dikonfigurasi di Netlify.');
  const now=Math.floor(Date.now()/1000),header=base64url({alg:'RS256',typ:'JWT'}),payload=base64url({iss:serviceEmail,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const unsigned=`${header}.${payload}`;const signer=crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();
  const assertion=`${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const body=await response.json();if(!response.ok||!body.access_token)throw new Error(body.error_description||body.error||'Gagal memperoleh token Google Sheets.');return body.access_token;
}

async function readMasterRanges(){
  const {sheetId}=sheetConfig(),token=await getGoogleAccessToken();
  const ranges=["'Master Lastmile'!A1:R1000","'Jarak Bandara-Kelurahan'!A1:AO1000","'Zona Operasional Awal'!A1:K100","'Modal Rute Pilot'!A24:AO200"];
  const params=new URLSearchParams({majorDimension:'ROWS',valueRenderOption:'UNFORMATTED_VALUE'});for(const range of ranges)params.append('ranges',range);
  const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${params.toString()}`,{headers:{authorization:`Bearer ${token}`}});
  const body=await response.json();if(!response.ok)throw new Error(body?.error?.message||'Gagal membaca Master Google Sheet.');return body.valueRanges||[];
}

function parseMaster(rows){return (rows||[]).slice(1).filter(row=>cell(row,0)).map(row=>({kodeRute:cell(row,0),hub:cell(row,1),feeder:cell(row,2),moda:cell(row,3),provinsi:cell(row,4),kabupatenKota:cell(row,5),kodeKabKota:cell(row,6),distrik:cell(row,7),kodeDistrik:cell(row,8),kelurahan:cell(row,9),kodeWilayah:cell(row,10),jenisWilayah:cell(row,11),jenisLayanan:cell(row,12),statusLayananMaster:cell(row,13),zonaTarif:cell(row,14),slaMaster:cell(row,15),catatanAkses:cell(row,16),sumber:cell(row,17)}));}
function parseDistance(rows){
  const map=new Map();for(const row of (rows||[]).slice(1)){const kodeRute=cell(row,0);if(!kodeRute)continue;map.set(kodeRute,{bandaraAsal:cell(row,2),titikAsal:cell(row,3),tujuanMaps:cell(row,9),jarakKm:numberOrNull(cell(row,10)),estimasiWaktu:cell(row,11),statusVerifikasi:cell(row,12),jenisAkses:cell(row,13),linkRuteMaps:cell(row,14),tanggalVerifikasi:cell(row,15),surveyor:cell(row,16),catatanJarak:cell(row,17),prosesHubJam:numberOrNull(cell(row,18)),bufferOperasionalJam:numberOrNull(cell(row,19)),slaLastmile:cell(row,20),slaTotalHub:cell(row,21),statusSla:cell(row,22),dasarSla:cell(row,23),tanggalReviewSla:cell(row,24),catatanSla:cell(row,25),skemaLayanan:cell(row,26),minimumLoadKg:numberOrNull(cell(row,27)),titikMulaiSla:cell(row,28),statusLayanan:cell(row,29),latitude:numberOrNull(cell(row,30)),longitude:numberOrNull(cell(row,31)),sumberKoordinat:cell(row,32),statusKoordinat:cell(row,33),tanggalGenerate:cell(row,34),alamatGoogle:cell(row,35),elevationGainOneWayM:numberOrNull(cell(row,36)),elevationLossOneWayM:numberOrNull(cell(row,37)),elevationMinM:numberOrNull(cell(row,38)),elevationMaxM:numberOrNull(cell(row,39)),elevationStatus:cell(row,40)});}return map;
}
function parseZones(rows){return (rows||[]).slice(1).filter(row=>cell(row,0)).map(row=>({kodeZona:cell(row,0),titikPickup:cell(row,1),kabupatenKota:cell(row,2),zonaOperasional:cell(row,3),cakupanAwal:cell(row,4),skemaLayanan:cell(row,5),minimumLoadKg:numberOrNull(cell(row,6)),titikMulaiSla:cell(row,7),statusLayanan:cell(row,8),statusVerifikasi:cell(row,9),catatan:cell(row,10)}));}
function parseEconomics(rows){
  const map=new Map();for(const row of (rows||[]).slice(1)){const kodeRute=text(cell(row,0));if(!kodeRute)continue;map.set(kodeRute,{grupModal:cell(row,4),jarakGoogleKm:numberOrNull(cell(row,5)),latitudeModal:numberOrNull(cell(row,6)),longitudeModal:numberOrNull(cell(row,7)),jarakDipakaiKm:numberOrNull(cell(row,8)),jarakPpKm:numberOrNull(cell(row,9)),minimumLoadDepartureKg:numberOrNull(cell(row,10)),bbmTrip:numberOrNull(cell(row,11)),maintenanceTrip:numberOrNull(cell(row,12)),sdmTrip:numberOrNull(cell(row,13)),miscTrip:numberOrNull(cell(row,14)),contingencyTrip:numberOrNull(cell(row,15)),fullCostTrip:numberOrNull(cell(row,16)),modalKerjaAmanTrip:numberOrNull(cell(row,17)),costPerKgMinLoad:numberOrNull(cell(row,18)),omzetMinTarget:numberOrNull(cell(row,19)),tarifCostPlusKg:numberOrNull(cell(row,20)),tarifFloorKg:numberOrNull(cell(row,21)),tarifRekomKg:numberOrNull(cell(row,22)),grossMarginMinLoad:numberOrNull(cell(row,23)),tripsPerHari:numberOrNull(cell(row,24)),cashOpex7Hari:numberOrNull(cell(row,25)),cashOpexBulan:numberOrNull(cell(row,26)),statusData:cell(row,27),statusPilot:cell(row,28),catatanModal:cell(row,29),depresiasiTrip:numberOrNull(cell(row,30)),pajakAsuransiTrip:numberOrNull(cell(row,31)),cashOpexTrip:numberOrNull(cell(row,32)),handlingIncomingTrip:numberOrNull(cell(row,33)),elevationGainModalM:numberOrNull(cell(row,34)),elevationLossModalM:numberOrNull(cell(row,35)),totalClimbRoundTripM:numberOrNull(cell(row,36)),fuelElevationExtraL:numberOrNull(cell(row,37)),terrainMaintenanceFactor:numberOrNull(cell(row,38)),elevationModelStatus:cell(row,39),effectiveFuelKmL:numberOrNull(cell(row,40))});}return map;
}

function confirmationRequired(route){const hay=upper(`${route.statusPilot||''} ${route.statusData||''} ${route.statusKoordinat||''} ${route.catatanModal||''}`);return hay.includes('KONFIRMASI')||hay.includes('PERLU KONFIRMASI');}
function mapRouteVerified(route){return upper(route.statusData)==='GOOGLE ROUTES'||boolText(route.statusKoordinat,'ROUTES PASS');}
function buildAutoSla(route){
  if(!mapRouteVerified(route)||confirmationRequired(route))return null;
  const driveHours=parseDurationHours(route.estimasiWaktu)||Math.max(0.25,(Number(route.jarakKm||route.jarakDipakaiKm)||0)/30);
  const distance=Number(route.jarakKm||route.jarakDipakaiKm)||0,processHub=Number(route.prosesHubJam)||4;
  const buffer=Number(route.bufferOperasionalJam)>0?Number(route.bufferOperasionalJam):(distance<=10?2:distance<=30?3:distance<=50?4:6);
  const lastmile=Math.max(4,roundUp(driveHours+buffer,2)),total=roundUp(processHub+lastmile,2);
  return {prosesHubJam:processHub,bufferOperasionalJam:buffer,slaLastmile:`${lastmile} jam`,slaTotalHub:`${total} jam`,statusSla:'AUTO PILOT - AKTIF',dasarSla:'Google Routes + proses hub + buffer operasional',titikMulaiSla:'SEJAK BARANG DITERIMA',autoSla:true};
}
function applyPilotAutomation(route){
  const economics=route.tarifRekomKg!==undefined||route.statusPilot?true:false;
  if(!economics)return route;
  const needsConfirmation=confirmationRequired(route),verified=mapRouteVerified(route),autoSla=buildAutoSla(route);
  const next={...route,minimumChargeableKg:AUTO_MIN_CHARGE_KG,autoPricing:Boolean(Number(route.tarifRekomKg)>0),autoVerified:verified,requiresOperationalConfirmation:needsConfirmation};
  if(Number(route.minimumLoadDepartureKg)>0)next.minimumLoadKg=Number(route.minimumLoadDepartureKg);
  if(Number(route.latitudeModal)&&!Number(route.latitude))next.latitude=Number(route.latitudeModal);
  if(Number(route.longitudeModal)&&!Number(route.longitude))next.longitude=Number(route.longitudeModal);
  if(Number(route.jarakDipakaiKm)>0&&!Number(route.jarakKm))next.jarakKm=Number(route.jarakDipakaiKm);
  if(autoSla)Object.assign(next,autoSla);
  if(needsConfirmation){next.statusVerifikasi='PERLU KONFIRMASI OPERASIONAL';next.statusLayanan='BELUM AKTIF';next.skemaLayanan='ON REQUEST';return next;}
  if(verified&&Number(route.tarifRekomKg)>0){next.statusVerifikasi='TERVERIFIKASI GOOGLE ROUTES';next.jenisAkses='DARAT';next.statusLayanan='AKTIF';next.skemaLayanan=upper(route.skemaLayanan).includes('CHARTER')?'CHARTER':'REGULER';next.autoPilotActive=true;}
  return next;
}

export function operationalDecision(route){
  const hub=upper(route.hub||route.bandaraAsal),distrik=upper(route.distrik),status=upper(route.statusLayanan||route.statusLayananMaster),verification=upper(route.statusVerifikasi),scheme=upper(route.skemaLayanan||route.jenisLayanan);
  if(route.requiresOperationalConfirmation)return {coverageStatus:'PENDING_VERIFICATION',bookable:false,reason:'Rute menunggu konfirmasi operasional lapangan.'};
  if(hub.includes('WMX')||hub.includes('WAMENA')){if(distrik!=='WAMENA')return {coverageStatus:'OUT_OF_COVERAGE',bookable:false,reason:'Last-mile WMX dibatasi hanya Distrik Wamena.'};if(status!=='AKTIF')return {coverageStatus:'MANUAL_REVIEW',bookable:false,reason:'Distrik Wamena belum dipublish sebagai layanan aktif.'};}
  if(scheme.includes('CHARTER'))return {coverageStatus:'CHARTER_REQUIRED',bookable:false,reason:'Rute wajib konfirmasi charter.'};
  if(scheme.includes('ON REQUEST'))return {coverageStatus:'ON_REQUEST',bookable:false,reason:'Rute wajib konfirmasi operasional.'};
  if(status!=='AKTIF')return {coverageStatus:'NOT_ACTIVE',bookable:false,reason:'Status layanan belum AKTIF.'};
  if(!verification||verification.includes('BELUM')||verification.includes('KONFIRMASI'))return {coverageStatus:'PENDING_VERIFICATION',bookable:false,reason:'Akses darat belum terverifikasi.'};
  if(route.minimumLoadKg>0)return {coverageStatus:'ACTIVE',bookable:true,minimumLoadRequired:true,reason:`Booking aktif. Keberangkatan mengikuti konsolidasi minimum ${route.minimumLoadKg} kg.`};
  return {coverageStatus:'ACTIVE',bookable:true,minimumLoadRequired:false,reason:'Rute aktif dan akses terverifikasi.'};
}
function enrichRoutes(routes){return routes.map(route=>{const automated=applyPilotAutomation(route);return {...automated,...operationalDecision(automated)};});}
function buildStats(routes,zones){const active=routes.filter(r=>r.coverageStatus==='ACTIVE').length,verified=routes.filter(r=>r.autoVerified||upper(r.statusVerifikasi).includes('TERVERIFIKASI')).length,minLoad=routes.filter(r=>r.minimumLoadRequired).length,onRequest=routes.filter(r=>r.coverageStatus==='ON_REQUEST').length,charter=routes.filter(r=>r.coverageStatus==='CHARTER_REQUIRED').length,outOfCoverage=routes.filter(r=>r.coverageStatus==='OUT_OF_COVERAGE').length,autoPriced=routes.filter(r=>r.autoPricing&&r.coverageStatus==='ACTIVE').length;return {totalRoutes:routes.length,totalZones:zones.length,active,verified,minLoad,onRequest,charter,outOfCoverage,autoPriced};}
function comparableRoute(route){return JSON.stringify({statusLayanan:route.statusLayanan,skemaLayanan:route.skemaLayanan,minimumLoadKg:route.minimumLoadKg,slaTotalHub:route.slaTotalHub,slaLastmile:route.slaLastmile,jarakKm:route.jarakKm,statusVerifikasi:route.statusVerifikasi,zonaTarif:route.zonaTarif,coverageStatus:route.coverageStatus,tarifRekomKg:route.tarifRekomKg,latitude:route.latitude,longitude:route.longitude,statusKoordinat:route.statusKoordinat,elevationStatus:route.elevationStatus||route.elevationModelStatus,totalClimbRoundTripM:route.totalClimbRoundTripM,effectiveFuelKmL:route.effectiveFuelKmL});}
function buildChanges(current,nextRoutes,nextZones){const previous=new Map((current?.routes||[]).map(row=>[row.kodeRute,row])),next=new Map(nextRoutes.map(row=>[row.kodeRute,row]));let added=0,removed=0,changed=0;for(const [key,row] of next){if(!previous.has(key))added+=1;else if(comparableRoute(previous.get(key))!==comparableRoute(row))changed+=1;}for(const key of previous.keys())if(!next.has(key))removed+=1;return {added,removed,changed,zoneCountBefore:current?.zones?.length||0,zoneCountAfter:nextZones.length};}
async function getStoredSnapshot(){return getStore(STORE_NAME).get(CURRENT_KEY,{type:'json',consistency:'strong'});}

async function buildSheetSnapshot(){
  const ranges=await readMasterRanges(),master=parseMaster(ranges[0]?.values||[]),distance=parseDistance(ranges[1]?.values||[]),zones=parseZones(ranges[2]?.values||[]),economics=parseEconomics(ranges[3]?.values||[]);
  const routes=enrichRoutes(master.map(row=>({...row,...(distance.get(row.kodeRute)||{}),...(economics.get(row.kodeRute)||{})})));
  return {routes,zones};
}

export async function autoSyncMasterSheet(source='AUTO_SCHEDULED'){
  if(!isSheetConfigured())throw new Error('Master Google Sheet belum dikonfigurasi.');
  const store=getStore(STORE_NAME),current=await getStoredSnapshot(),{routes,zones}=await buildSheetSnapshot(),stamp=new Date().toISOString(),changes=buildChanges(current,routes,zones);
  const snapshot={version:crypto.randomUUID(),sheetId:sheetConfig().sheetId,sheetUrl:`https://docs.google.com/spreadsheets/d/${sheetConfig().sheetId}/edit`,status:'PUBLISHED',syncMode:'AUTO',syncSource:String(source||'AUTO').slice(0,80),previewedAt:stamp,publishedAt:stamp,syncedAt:stamp,stats:buildStats(routes,zones),changes,routes,zones};
  if(current)await store.setJSON(`snapshot/history/${stamp}-${String(current.version||'unknown')}`,{version:current.version,publishedAt:current.publishedAt||current.syncedAt,stats:current.stats,changesToNext:changes},{onlyIfNew:true});
  await store.setJSON(CURRENT_KEY,snapshot);await store.delete(PENDING_KEY).catch(()=>{});await store.setJSON(LAST_SYNC_KEY,{version:snapshot.version,syncedAt:stamp,source:snapshot.syncSource,stats:snapshot.stats,changes});return snapshot;
}

export async function previewMasterSheet(){const store=getStore(STORE_NAME),current=await getStoredSnapshot(),{routes,zones}=await buildSheetSnapshot(),snapshot={version:crypto.randomUUID(),sheetId:sheetConfig().sheetId,sheetUrl:`https://docs.google.com/spreadsheets/d/${sheetConfig().sheetId}/edit`,previewedAt:new Date().toISOString(),status:'PENDING_APPROVAL',stats:buildStats(routes,zones),changes:buildChanges(current,routes,zones),routes,zones};await store.setJSON(PENDING_KEY,snapshot);return snapshot;}
export async function publishPendingSnapshot(){const store=getStore(STORE_NAME),pending=await getPendingSnapshot();if(!pending)throw new Error('Tidak ada preview Master Sheet yang menunggu approval.');const stamp=new Date().toISOString(),published={...pending,status:'PUBLISHED',syncMode:'MANUAL',publishedAt:stamp,syncedAt:stamp};await store.setJSON(CURRENT_KEY,published);await store.delete(PENDING_KEY);return published;}
export async function getMasterSnapshot(){return getStoredSnapshot();}
export async function getPendingSnapshot(){return getStore(STORE_NAME).get(PENDING_KEY,{type:'json',consistency:'strong'});}
export async function getLastMasterSync(){return getStore(STORE_NAME).get(LAST_SYNC_KEY,{type:'json',consistency:'strong'});}
export async function findRoute({kodeRute,kodeWilayah,kelurahan,distrik}={}){const snapshot=await getMasterSnapshot();if(!snapshot)return null;const route=snapshot.routes.find(row=>{if(kodeRute&&row.kodeRute===kodeRute)return true;if(kodeWilayah&&row.kodeWilayah===kodeWilayah)return true;if(kelurahan&&String(row.kelurahan).toLowerCase()===String(kelurahan).toLowerCase()&&(!distrik||String(row.distrik).toLowerCase()===String(distrik).toLowerCase()))return true;return false;});return route?{route,syncedAt:snapshot.syncedAt,version:snapshot.version}:null;}
