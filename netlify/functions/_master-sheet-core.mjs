import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const STORE_NAME='libra-master-sync';
const CURRENT_KEY='snapshot/current';
const PENDING_KEY='snapshot/pending';

function base64url(value){
  return Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
}
function normalizePrivateKey(value){return String(value||'').replace(/\\n/g,'\n').trim();}
function cell(row,index){return row?.[index]??'';}
function upper(value){return String(value||'').trim().toUpperCase();}
function numberOrNull(value){
  let normalized=String(value??'').trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if(!normalized)return null;
  if(normalized.includes(',')&&normalized.includes('.'))normalized=normalized.replace(/\./g,'').replace(',','.');
  else if(normalized.includes(','))normalized=normalized.replace(',','.');
  const number=Number(normalized);
  return Number.isFinite(number)?number:null;
}

export function sheetConfig(){
  return {
    sheetId:process.env.MASTER_SHEET_ID||DEFAULT_SHEET_ID,
    serviceEmail:String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL||'').trim(),
    privateKey:normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
  };
}
export function isSheetConfigured(){
  const config=sheetConfig();
  return Boolean(config.sheetId&&config.serviceEmail&&config.privateKey);
}

async function getGoogleAccessToken(){
  const {serviceEmail,privateKey}=sheetConfig();
  if(!serviceEmail||!privateKey)throw new Error('Google Service Account belum dikonfigurasi di Netlify.');
  const now=Math.floor(Date.now()/1000);
  const header=base64url({alg:'RS256',typ:'JWT'});
  const payload=base64url({iss:serviceEmail,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const unsigned=`${header}.${payload}`;
  const signer=crypto.createSign('RSA-SHA256');
  signer.update(unsigned);signer.end();
  const assertion=`${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
  });
  const body=await response.json();
  if(!response.ok||!body.access_token)throw new Error(body.error_description||body.error||'Gagal memperoleh token Google Sheets.');
  return body.access_token;
}

async function readMasterRanges(){
  const {sheetId}=sheetConfig();
  const token=await getGoogleAccessToken();
  const ranges=["'Master Lastmile'!A1:R1000","'Jarak Bandara-Kelurahan'!A1:AD1000","'Zona Operasional Awal'!A1:K100"];
  const params=new URLSearchParams({majorDimension:'ROWS',valueRenderOption:'FORMATTED_VALUE'});
  for(const range of ranges)params.append('ranges',range);
  const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${params.toString()}`,{headers:{authorization:`Bearer ${token}`}});
  const body=await response.json();
  if(!response.ok)throw new Error(body?.error?.message||'Gagal membaca Master Google Sheet.');
  return body.valueRanges||[];
}

function parseMaster(rows){
  return (rows||[]).slice(1).filter(row=>cell(row,0)).map(row=>({
    kodeRute:cell(row,0),hub:cell(row,1),feeder:cell(row,2),moda:cell(row,3),provinsi:cell(row,4),kabupatenKota:cell(row,5),kodeKabKota:cell(row,6),distrik:cell(row,7),kodeDistrik:cell(row,8),kelurahan:cell(row,9),kodeWilayah:cell(row,10),jenisWilayah:cell(row,11),jenisLayanan:cell(row,12),statusLayananMaster:cell(row,13),zonaTarif:cell(row,14),slaMaster:cell(row,15),catatanAkses:cell(row,16),sumber:cell(row,17),
  }));
}
function parseDistance(rows){
  const map=new Map();
  for(const row of (rows||[]).slice(1)){
    const kodeRute=cell(row,0);if(!kodeRute)continue;
    map.set(kodeRute,{
      bandaraAsal:cell(row,2),titikAsal:cell(row,3),tujuanMaps:cell(row,9),jarakKm:numberOrNull(cell(row,10)),estimasiWaktu:cell(row,11),statusVerifikasi:cell(row,12),jenisAkses:cell(row,13),linkRuteMaps:cell(row,14),tanggalVerifikasi:cell(row,15),surveyor:cell(row,16),catatanJarak:cell(row,17),prosesHubJam:numberOrNull(cell(row,18)),bufferOperasionalJam:numberOrNull(cell(row,19)),slaLastmile:cell(row,20),slaTotalHub:cell(row,21),statusSla:cell(row,22),dasarSla:cell(row,23),tanggalReviewSla:cell(row,24),catatanSla:cell(row,25),skemaLayanan:cell(row,26),minimumLoadKg:numberOrNull(cell(row,27)),titikMulaiSla:cell(row,28),statusLayanan:cell(row,29),
    });
  }
  return map;
}
function parseZones(rows){
  return (rows||[]).slice(1).filter(row=>cell(row,0)).map(row=>({
    kodeZona:cell(row,0),titikPickup:cell(row,1),kabupatenKota:cell(row,2),zonaOperasional:cell(row,3),cakupanAwal:cell(row,4),skemaLayanan:cell(row,5),minimumLoadKg:numberOrNull(cell(row,6)),titikMulaiSla:cell(row,7),statusLayanan:cell(row,8),statusVerifikasi:cell(row,9),catatan:cell(row,10),
  }));
}

export function operationalDecision(route){
  const hub=upper(route.hub||route.bandaraAsal);
  const distrik=upper(route.distrik);
  const status=upper(route.statusLayanan||route.statusLayananMaster);
  const verification=upper(route.statusVerifikasi);
  const scheme=upper(route.skemaLayanan||route.jenisLayanan);

  // Kebijakan tahap awal: Wamena hanya last-mile dalam Distrik Wamena.
  if(hub.includes('WMX')||hub.includes('WAMENA')){
    if(distrik!=='WAMENA')return {coverageStatus:'OUT_OF_COVERAGE',bookable:false,reason:'Last-mile WMX dibatasi hanya Distrik Wamena.'};
    if(status!=='AKTIF')return {coverageStatus:'MANUAL_REVIEW',bookable:false,reason:'Distrik Wamena belum dipublish sebagai layanan aktif.'};
  }

  if(scheme.includes('CHARTER'))return {coverageStatus:'CHARTER_REQUIRED',bookable:false,reason:'Rute wajib konfirmasi charter.'};
  if(scheme.includes('ON REQUEST'))return {coverageStatus:'ON_REQUEST',bookable:false,reason:'Rute wajib konfirmasi operasional.'};
  if(status!=='AKTIF')return {coverageStatus:'NOT_ACTIVE',bookable:false,reason:'Status layanan belum AKTIF.'};
  if(!verification||verification.includes('BELUM')||verification.includes('KONFIRMASI'))return {coverageStatus:'PENDING_VERIFICATION',bookable:false,reason:'Akses darat belum terverifikasi.'};
  if(route.minimumLoadKg>0||scheme.includes('MINIMUM'))return {coverageStatus:'MINIMUM_LOAD',bookable:false,reason:`Minimum load ${route.minimumLoadKg||0} kg harus terpenuhi sebelum booking final.`};
  return {coverageStatus:'ACTIVE',bookable:true,reason:'Rute aktif dan akses terverifikasi.'};
}

function enrichRoutes(routes){return routes.map(route=>({...route,...operationalDecision(route)}));}
function buildStats(routes,zones){
  const active=routes.filter(row=>row.coverageStatus==='ACTIVE').length;
  const verified=routes.filter(row=>upper(row.statusVerifikasi).includes('TERVERIFIKASI')&&!upper(row.statusVerifikasi).includes('BELUM')).length;
  const minLoad=routes.filter(row=>row.coverageStatus==='MINIMUM_LOAD').length;
  const onRequest=routes.filter(row=>row.coverageStatus==='ON_REQUEST').length;
  const charter=routes.filter(row=>row.coverageStatus==='CHARTER_REQUIRED').length;
  const outOfCoverage=routes.filter(row=>row.coverageStatus==='OUT_OF_COVERAGE').length;
  return {totalRoutes:routes.length,totalZones:zones.length,active,verified,minLoad,onRequest,charter,outOfCoverage};
}
function comparableRoute(route){
  return JSON.stringify({statusLayanan:route.statusLayanan,skemaLayanan:route.skemaLayanan,minimumLoadKg:route.minimumLoadKg,slaTotalHub:route.slaTotalHub,slaLastmile:route.slaLastmile,jarakKm:route.jarakKm,statusVerifikasi:route.statusVerifikasi,zonaTarif:route.zonaTarif,coverageStatus:route.coverageStatus});
}
function buildChanges(current,nextRoutes,nextZones){
  const previous=new Map((current?.routes||[]).map(row=>[row.kodeRute,row]));
  const next=new Map(nextRoutes.map(row=>[row.kodeRute,row]));
  let added=0,removed=0,changed=0;
  for(const [key,row] of next){if(!previous.has(key))added+=1;else if(comparableRoute(previous.get(key))!==comparableRoute(row))changed+=1;}
  for(const key of previous.keys())if(!next.has(key))removed+=1;
  return {added,removed,changed,zoneCountBefore:current?.zones?.length||0,zoneCountAfter:nextZones.length};
}

async function buildSheetSnapshot(){
  const ranges=await readMasterRanges();
  const master=parseMaster(ranges[0]?.values||[]);
  const distance=parseDistance(ranges[1]?.values||[]);
  const zones=parseZones(ranges[2]?.values||[]);
  const routes=enrichRoutes(master.map(row=>({...row,...(distance.get(row.kodeRute)||{})})));
  return {routes,zones};
}

export async function previewMasterSheet(){
  const store=getStore(STORE_NAME);
  const current=await getMasterSnapshot();
  const {routes,zones}=await buildSheetSnapshot();
  const snapshot={
    version:crypto.randomUUID(),sheetId:sheetConfig().sheetId,sheetUrl:`https://docs.google.com/spreadsheets/d/${sheetConfig().sheetId}/edit`,
    previewedAt:new Date().toISOString(),status:'PENDING_APPROVAL',stats:buildStats(routes,zones),changes:buildChanges(current,routes,zones),routes,zones,
  };
  await store.setJSON(PENDING_KEY,snapshot);
  return snapshot;
}

export async function publishPendingSnapshot(){
  const store=getStore(STORE_NAME);
  const pending=await getPendingSnapshot();
  if(!pending)throw new Error('Tidak ada preview Master Sheet yang menunggu approval.');
  const published={...pending,status:'PUBLISHED',publishedAt:new Date().toISOString(),syncedAt:new Date().toISOString()};
  await store.setJSON(CURRENT_KEY,published);
  await store.delete(PENDING_KEY);
  return published;
}

export async function getMasterSnapshot(){return getStore(STORE_NAME).get(CURRENT_KEY,{type:'json',consistency:'strong'});}
export async function getPendingSnapshot(){return getStore(STORE_NAME).get(PENDING_KEY,{type:'json',consistency:'strong'});}

export async function findRoute({kodeRute,kodeWilayah,kelurahan,distrik}={}){
  const snapshot=await getMasterSnapshot();
  if(!snapshot)return null;
  const route=snapshot.routes.find(row=>{
    if(kodeRute&&row.kodeRute===kodeRute)return true;
    if(kodeWilayah&&row.kodeWilayah===kodeWilayah)return true;
    if(kelurahan&&String(row.kelurahan).toLowerCase()===String(kelurahan).toLowerCase()&&(!distrik||String(row.distrik).toLowerCase()===String(distrik).toLowerCase()))return true;
    return false;
  });
  return route?{route,syncedAt:snapshot.syncedAt,version:snapshot.version}:null;
}
