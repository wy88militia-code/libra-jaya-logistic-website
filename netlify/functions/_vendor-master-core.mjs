import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const STORE='libra-vendor-master';
const CURRENT='snapshot/current';
const PENDING='snapshot/pending';
const HISTORY_PREFIX='snapshot/history/';
const VALID_CATEGORIES=new Set(['AIRLINE','TRUCKING','SEA_FREIGHT','LAST_MILE','PICKUP','HANDLING','WAREHOUSE','PACKING','INSURANCE','OTHER']);
const VALID_RATE_TYPES=new Set(['PER_KG','FLAT']);
const clean=(v,n=240)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const cell=(r,i)=>r?.[i]??'';
const base64url=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const normalizeKey=v=>String(v||'').replace(/\\n/g,'\n').trim();

function num(v){
  let x=String(v??'').trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if(!x)return null;
  if(x.includes(',')&&x.includes('.'))x=x.replace(/\./g,'').replace(',','.');
  else if(x.includes(','))x=x.replace(',','.');
  const n=Number(x);return Number.isFinite(n)?n:null;
}
function config(){return {sheetId:process.env.MASTER_SHEET_ID||DEFAULT_SHEET_ID,email:clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),privateKey:normalizeKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)};}
export function isVendorMasterConfigured(){const c=config();return Boolean(c.sheetId&&c.email&&c.privateKey);}

async function accessToken(){
  const c=config();if(!c.email||!c.privateKey)throw new Error('Google Service Account belum dikonfigurasi di Netlify.');
  const now=Math.floor(Date.now()/1000),header=base64url({alg:'RS256',typ:'JWT'}),payload=base64url({iss:c.email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),unsigned=`${header}.${payload}`;
  const signer=crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();
  const assertion=`${unsigned}.${signer.sign(c.privateKey).toString('base64url')}`;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})}),b=await r.json();
  if(!r.ok||!b.access_token)throw new Error(b.error_description||b.error||'Gagal memperoleh token Google Sheets.');return b.access_token;
}
async function readRanges(){
  const c=config(),token=await accessToken(),ranges=["'VENDOR_MASTER'!A1:H1000","'VENDOR_RATE'!A1:Q5000","'SURCHARGE'!A1:J2000"],p=new URLSearchParams({majorDimension:'ROWS',valueRenderOption:'FORMATTED_VALUE'});
  for(const x of ranges)p.append('ranges',x);
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.sheetId)}/values:batchGet?${p.toString()}`,{headers:{authorization:`Bearer ${token}`}}),b=await r.json();
  if(!r.ok)throw new Error(b?.error?.message||'Gagal membaca Vendor Master Google Sheet.');return b.valueRanges||[];
}
function parseVendors(rows){return (rows||[]).slice(1).filter(r=>cell(r,0)).map(r=>({vendorId:upper(cell(r,0)),vendorName:clean(cell(r,1),160),vendorType:upper(cell(r,2)),taxId:clean(cell(r,3),80)||null,pic:clean(cell(r,4),120)||null,phone:clean(cell(r,5),60)||null,status:upper(cell(r,6))||'ACTIVE',note:clean(cell(r,7),500)||null}));}
function parseRates(rows){return (rows||[]).slice(1).filter(r=>cell(r,0)).map(r=>({rateId:upper(cell(r,0)),vendorId:upper(cell(r,1)),category:upper(cell(r,2)),routeCode:upper(cell(r,3)),service:upper(cell(r,4))||null,cargoType:upper(cell(r,5))||null,rateType:upper(cell(r,6))||'PER_KG',ratePerKg:num(cell(r,7))||0,minChargeKg:num(cell(r,8))||0,flatAmount:num(cell(r,9))||0,effectiveFrom:clean(cell(r,10),20)||null,effectiveTo:clean(cell(r,11),20)||null,currency:upper(cell(r,12))||'IDR',status:upper(cell(r,13))||'ACTIVE',priority:Math.trunc(num(cell(r,14))||0),note:clean(cell(r,15),500)||null,sourceRef:clean(cell(r,16),160)||null}));}
function parseSurcharges(rows){return (rows||[]).slice(1).filter(r=>cell(r,0)).map(r=>({surchargeId:upper(cell(r,0)),vendorId:upper(cell(r,1)),routeCode:upper(cell(r,2)),category:upper(cell(r,3))||null,name:clean(cell(r,4),140),amount:num(cell(r,5))||0,perKg:upper(cell(r,6))==='YES',effectiveFrom:clean(cell(r,7),20)||null,effectiveTo:clean(cell(r,8),20)||null,status:upper(cell(r,9))||'ACTIVE'}));}
function validate(vendors,rates,surcharges){
  const errors=[];
  if(!vendors.length)errors.push('VENDOR_MASTER belum memiliki vendor.');if(!rates.length)errors.push('VENDOR_RATE belum memiliki rate.');
  const vendorIds=new Set(),activeVendorIds=new Set();
  for(const v of vendors){if(vendorIds.has(v.vendorId))errors.push(`Vendor ID duplikat: ${v.vendorId}`);vendorIds.add(v.vendorId);if(!v.vendorName)errors.push(`Nama vendor wajib: ${v.vendorId}`);if(v.status==='ACTIVE')activeVendorIds.add(v.vendorId);}
  const rateIds=new Set();
  for(const r of rates){if(rateIds.has(r.rateId))errors.push(`Rate ID duplikat: ${r.rateId}`);rateIds.add(r.rateId);if(!activeVendorIds.has(r.vendorId))errors.push(`Vendor tidak aktif/tidak ditemukan: ${r.vendorId}`);if(!VALID_CATEGORIES.has(r.category))errors.push(`Kategori rate tidak valid: ${r.rateId}`);if(!VALID_RATE_TYPES.has(r.rateType))errors.push(`Rate type tidak valid: ${r.rateId}`);if(!r.routeCode)errors.push(`Route code wajib: ${r.rateId}`);if(r.currency!=='IDR')errors.push(`Currency sementara wajib IDR: ${r.rateId}`);if(r.minChargeKg<0)errors.push(`Minimum charge negatif: ${r.rateId}`);if(r.rateType==='PER_KG'&&r.ratePerKg<=0)errors.push(`Rate/kg wajib > 0: ${r.rateId}`);if(r.rateType==='FLAT'&&r.flatAmount<=0)errors.push(`Flat amount wajib > 0: ${r.rateId}`);if(r.effectiveFrom&&r.effectiveTo&&r.effectiveTo<r.effectiveFrom)errors.push(`Periode rate terbalik: ${r.rateId}`);}
  const surchargeIds=new Set();
  for(const s of surcharges){if(surchargeIds.has(s.surchargeId))errors.push(`Surcharge ID duplikat: ${s.surchargeId}`);surchargeIds.add(s.surchargeId);if(!activeVendorIds.has(s.vendorId))errors.push(`Vendor surcharge tidak aktif/tidak ditemukan: ${s.vendorId}`);if(!s.routeCode)errors.push(`Route surcharge wajib: ${s.surchargeId}`);if(s.category&&!VALID_CATEGORIES.has(s.category))errors.push(`Kategori surcharge tidak valid: ${s.surchargeId}`);if(s.amount<0)errors.push(`Surcharge negatif: ${s.surchargeId}`);if(s.effectiveFrom&&s.effectiveTo&&s.effectiveTo<s.effectiveFrom)errors.push(`Periode surcharge terbalik: ${s.surchargeId}`);}
  return errors;
}
export async function previewVendorMaster(actor='finance'){
  const [vr,rr,sr]=await readRanges(),vendors=parseVendors(vr?.values),rates=parseRates(rr?.values),surcharges=parseSurcharges(sr?.values),errors=validate(vendors,rates,surcharges),c=config();
  const snapshot={version:crypto.randomUUID(),sheetId:c.sheetId,sheetUrl:`https://docs.google.com/spreadsheets/d/${c.sheetId}/edit`,status:errors.length?'INVALID':'PENDING_APPROVAL',previewedAt:new Date().toISOString(),previewedBy:clean(actor,100),stats:{vendors:vendors.length,rates:rates.length,surcharges:surcharges.length,errors:errors.length},errors:errors.slice(0,200),vendors,rates,surcharges};
  await getStore(STORE).setJSON(PENDING,snapshot);return snapshot;
}
export async function publishVendorMaster(actor='superadmin'){
  const s=getStore(STORE),pending=await s.get(PENDING,{type:'json',consistency:'strong'});if(!pending)throw new Error('Tidak ada preview Vendor Master.');if(pending.status==='INVALID'||pending.errors?.length)throw new Error('Vendor Master masih memiliki error dan tidak dapat dipublish.');
  const publisher=clean(actor,100);if(pending.previewedBy&&pending.previewedBy===publisher)throw new Error('Maker dan checker Vendor Master harus user yang berbeda.');
  const published={...pending,status:'PUBLISHED',publishedAt:new Date().toISOString(),publishedBy:publisher};
  const history=await s.setJSON(`${HISTORY_PREFIX}${published.version}`,published,{onlyIfNew:true});if(!history.modified)throw new Error('Snapshot version sudah pernah dipublish.');
  await s.setJSON(CURRENT,published);await s.delete(PENDING);return published;
}
export async function getVendorMaster(){return getStore(STORE).get(CURRENT,{type:'json',consistency:'strong'});}
export async function getVendorMasterVersion(version){return getStore(STORE).get(`${HISTORY_PREFIX}${clean(version,80)}`,{type:'json',consistency:'strong'});}
export async function getPendingVendorMaster(){return getStore(STORE).get(PENDING,{type:'json',consistency:'strong'});}
function dateActive(r,at){const d=String(at||new Date().toISOString()).slice(0,10);return (!r.effectiveFrom||r.effectiveFrom<=d)&&(!r.effectiveTo||r.effectiveTo>=d);}
export async function estimateVendorCostForBooking(booking={},snapshot=null){
  const snap=snapshot||await getVendorMaster();if(!snap)return {snapshotVersion:null,total:0,components:[],status:'NO_MASTER'};
  const route=upper(booking.kodeRute||booking.routeCode),service=upper(booking.serviceCode||booking.service||booking.serviceType||booking.skemaLayanan),cargo=upper(booking.cargoType||booking.goodsType),weight=Math.max(0,Number(booking.chargeableWeightKg||booking.chargeableKg||booking.actualWeightKg||booking.weightKg||0)),at=booking.createdAt||new Date().toISOString(),vendors=new Map((snap.vendors||[]).map(v=>[v.vendorId,v]));
  const candidates=(snap.rates||[]).filter(r=>r.status==='ACTIVE'&&r.routeCode===route&&dateActive(r,at)&&(!r.service||(service&&r.service===service))&&(!r.cargoType||(cargo&&r.cargoType===cargo))).sort((a,b)=>b.priority-a.priority);
  const byCategory=new Map();for(const r of candidates)if(!byCategory.has(r.category))byCategory.set(r.category,r);
  const components=[];
  for(const r of byCategory.values()){
    const billable=Math.max(weight,Number(r.minChargeKg||0)),base=r.rateType==='FLAT'?Number(r.flatAmount||0):Math.round(billable*Number(r.ratePerKg||0));let surcharge=0;
    for(const s of snap.surcharges||[]){if(s.status!=='ACTIVE'||s.vendorId!==r.vendorId||s.routeCode!==route||!dateActive(s,at))continue;if(s.category&&s.category!==r.category)continue;surcharge+=s.perKg?Math.round(weight*Number(s.amount||0)):Number(s.amount||0);}
    components.push({rateId:r.rateId,vendorId:r.vendorId,vendorName:vendors.get(r.vendorId)?.vendorName||r.vendorId,category:r.category,baseCost:base,surchargeCost:surcharge,totalCost:base+surcharge});
  }
  return {snapshotVersion:snap.version,total:components.reduce((n,x)=>n+x.totalCost,0),components,status:components.length?'ESTIMATED':'NO_MATCHING_RATE'};
}
