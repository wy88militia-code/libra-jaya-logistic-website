import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking } from './_booking-core.mjs';

const STORE='libra-smu-registry';
const MEDIA_STORE='libra-smu-media';
const store=()=>getStore(STORE);
const mediaStore=()=>getStore(MEDIA_STORE);
const now=()=>new Date().toISOString();
const clean=(v,n=120)=>String(v??'').trim().slice(0,n);
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
export const INCOMING_HANDLING_PER_SMU=25000;
export const SMU_CONDITIONS=['OK','DAMAGED','MISSING','MIXED_UP','HELD','OTHER'];
export function normalizeSmuNumber(v){return clean(v,80).toUpperCase().replace(/[^A-Z0-9./_-]/g,'');}

function normalizeMode(value,count){const raw=clean(value,20).toUpperCase();if(raw==='SINGLE'||raw==='GABUNGAN')return raw;return count>1?'GABUNGAN':'SINGLE';}
function normalizeExpectedItem(input={},index=0){
  const smuNumber=normalizeSmuNumber(input.smuNumber||input.number);const airline=clean(input.airline,80).toUpperCase();const origin=clean(input.origin,20).toUpperCase();const destination=clean(input.destination,20).toUpperCase();const pieces=Math.trunc(Number(input.pieces));const weightKg=finite(input.weightKg);
  if(!smuNumber)throw new Error(`SMU #${index+1}: nomor SMU wajib.`);if(!airline)throw new Error(`SMU ${smuNumber}: maskapai wajib.`);if(!origin||!destination)throw new Error(`SMU ${smuNumber}: origin dan destination wajib.`);if(!Number.isInteger(pieces)||pieces<1)throw new Error(`SMU ${smuNumber}: jumlah koli minimal 1.`);if(!Number.isFinite(weightKg)||weightKg<=0)throw new Error(`SMU ${smuNumber}: berat wajib lebih dari 0 kg.`);
  return {smuNumber,airline,flightNumber:clean(input.flightNumber,40).toUpperCase()||null,flightDate:clean(input.flightDate,20)||null,origin,destination,pieces,weightKg:Number(weightKg.toFixed(2)),commodity:clean(input.commodity,160)||null,note:clean(input.note,300)||null};
}
export function prepareSmuManifest(input={},expectedWeightKg=null){
  const source=Array.isArray(input)?input:(Array.isArray(input?.smus)?input.smus:[]);if(!source.length)throw new Error('Minimal 1 SMU wajib diinput pada booking.');if(source.length>30)throw new Error('Maksimum 30 SMU dalam satu booking gabungan.');
  const items=source.map(normalizeExpectedItem);const numbers=new Set();for(const item of items){if(numbers.has(item.smuNumber))throw new Error(`Nomor SMU duplikat: ${item.smuNumber}.`);numbers.add(item.smuNumber);}
  const mode=normalizeMode(Array.isArray(input)?null:input?.smuMode,items.length);if(mode==='SINGLE'&&items.length!==1)throw new Error('Mode SINGLE hanya boleh berisi 1 SMU.');if(mode==='GABUNGAN'&&items.length<2)throw new Error('Mode GABUNGAN minimal berisi 2 SMU.');
  const summary={smuCount:items.length,totalPieces:items.reduce((a,b)=>a+b.pieces,0),totalWeightKg:Number(items.reduce((a,b)=>a+b.weightKg,0).toFixed(2))};
  const expected=finite(expectedWeightKg);if(Number.isFinite(expected)&&Math.abs(summary.totalWeightKg-expected)>0.2)throw new Error(`Total berat SMU ${summary.totalWeightKg} kg tidak sama dengan berat quote ${Number(expected).toFixed(2)} kg.`);
  return {mode,items,summary};
}
export async function saveBookingSmuManifest(bookingId,input={},actor='partner',expectedWeightKg=null){
  const id=clean(bookingId,120);if(!id)throw new Error('Booking ID wajib.');const booking=await getBooking(id);if(!booking)throw new Error('Booking tidak ditemukan.');const prepared=prepareSmuManifest(input,expectedWeightKg??booking.weightKg);const previous=await getBookingSmuManifest(id);const t=now();
  const row={bookingId:id,partnerId:booking.partnerId||null,kodeRute:booking.kodeRute||null,smuMode:prepared.mode,items:prepared.items,summary:prepared.summary,createdAt:previous?.createdAt||t,updatedAt:t,updatedBy:clean(actor,100)};await store().setJSON(`manifest/${id}`,row);return row;
}
export async function getBookingSmuManifest(bookingId){const id=clean(bookingId,120);return id?store().get(`manifest/${id}`,{type:'json',consistency:'strong'}):null;}

export async function saveSmuIssuePhoto(file,bookingId,smuNumber){
  const id=clean(bookingId,120),smu=normalizeSmuNumber(smuNumber);if(!id||!smu)throw new Error('Booking ID dan SMU wajib untuk foto masalah.');if(!file||typeof file.arrayBuffer!=='function'||!file.size)return null;const allowed=new Set(['image/jpeg','image/png','image/webp']);if(!allowed.has(file.type))throw new Error(`Foto masalah SMU ${smu} harus JPG, PNG, atau WEBP.`);if(file.size>5*1024*1024)throw new Error(`Foto masalah SMU ${smu} maksimal 5 MB.`);
  const mediaId=`SMUIMG-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;const bytes=Buffer.from(await file.arrayBuffer());const sha256=crypto.createHash('sha256').update(bytes).digest('hex');await mediaStore().setJSON(`media/${mediaId}`,{mediaId,bookingId:id,smuNumber:smu,contentType:file.type,originalName:clean(file.name||'smu-issue',120),size:file.size,sha256,base64:bytes.toString('base64'),uploadedAt:now(),immutable:true},{onlyIfNew:true});return mediaId;
}
export async function getSmuIssuePhoto(mediaId){return mediaStore().get(`media/${clean(mediaId,140)}`,{type:'json',consistency:'strong'});}

export async function getBookingSmuReconciliation(bookingId){const id=clean(bookingId,120);return id?store().get(`reconciliation/${id}`,{type:'json',consistency:'strong'}):null;}
export async function reconcileBookingSmu(bookingId,inputRows=[],actor='courier'){
  const id=clean(bookingId,120);const booking=await getBooking(id);if(!booking)throw new Error('Booking tidak ditemukan.');if(!['AT_ORIGIN_HUB','HELD','DAMAGED','LOST','MIXED_UP','CLAIM_PROCESS'].includes(String(booking.status||'').toUpperCase()))throw new Error('Rekap fisik SMU hanya boleh setelah tracking GUDANG INCOMING (AT_ORIGIN_HUB).');
  const manifest=await getBookingSmuManifest(id);if(!manifest?.items?.length)throw new Error('Manifest SMU booking belum tersedia.');const rows=Array.isArray(inputRows)?inputRows:[];const byNumber=new Map(rows.map(r=>[normalizeSmuNumber(r.smuNumber),r]));const result=[];
  for(const expected of manifest.items){const raw=byNumber.get(expected.smuNumber);if(!raw)throw new Error(`Rekap fisik SMU ${expected.smuNumber} belum diisi.`);const actualPieces=Math.trunc(Number(raw.actualPieces));const actualWeightKg=finite(raw.actualWeightKg);const condition=clean(raw.condition,40).toUpperCase();const note=clean(raw.note,800);const issuePhotoId=clean(raw.issuePhotoId,140)||null;if(!Number.isInteger(actualPieces)||actualPieces<0)throw new Error(`SMU ${expected.smuNumber}: koli aktual tidak valid.`);if(!Number.isFinite(actualWeightKg)||actualWeightKg<0)throw new Error(`SMU ${expected.smuNumber}: berat aktual tidak valid.`);if(!SMU_CONDITIONS.includes(condition))throw new Error(`SMU ${expected.smuNumber}: kondisi tidak valid.`);if(condition!=='OK'&&(!note||!issuePhotoId))throw new Error(`SMU ${expected.smuNumber}: masalah ${condition} wajib foto dan keterangan.`);
    result.push({smuNumber:expected.smuNumber,expectedPieces:expected.pieces,expectedWeightKg:expected.weightKg,actualPieces,actualWeightKg:Number(actualWeightKg.toFixed(2)),piecesVariance:actualPieces-expected.pieces,weightVarianceKg:Number((actualWeightKg-expected.weightKg).toFixed(2)),condition,note:note||null,issuePhotoId,checkedAt:now(),checkedBy:clean(actor,100)});
  }
  const issues=result.filter(r=>r.condition!=='OK');const t=now();const row={bookingId:id,partnerId:booking.partnerId||null,status:issues.length?'COMPLETE_WITH_ISSUE':'COMPLETE_OK',rows:result,summary:{smuCount:result.length,totalExpectedPieces:result.reduce((a,b)=>a+b.expectedPieces,0),totalActualPieces:result.reduce((a,b)=>a+b.actualPieces,0),totalExpectedWeightKg:Number(result.reduce((a,b)=>a+b.expectedWeightKg,0).toFixed(2)),totalActualWeightKg:Number(result.reduce((a,b)=>a+b.actualWeightKg,0).toFixed(2)),issueCount:issues.length,issueSmus:issues.map(r=>r.smuNumber)},completedAt:t,updatedAt:t,updatedBy:clean(actor,100)};await store().setJSON(`reconciliation/${id}`,row);return row;
}
export async function bookingSmuReadyForRoute(bookingId){const manifest=await getBookingSmuManifest(bookingId);if(!manifest?.items?.length)return {ready:false,reason:'SMU_MANIFEST_MISSING'};const reconciliation=await getBookingSmuReconciliation(bookingId);if(!reconciliation||!String(reconciliation.status||'').startsWith('COMPLETE'))return {ready:false,reason:'PHYSICAL_RECONCILIATION_PENDING',manifest};return {ready:true,manifest,reconciliation,hasIssue:Number(reconciliation.summary?.issueCount||0)>0};}

// Compatibility helpers untuk modul lama yang masih membaca 1 nomor SMU per booking.
export async function getBookingSmu(bookingId){const id=clean(bookingId,120);if(!id)return null;const manifest=await getBookingSmuManifest(id);if(manifest?.items?.length)return {bookingId:id,partnerId:manifest.partnerId,kodeRute:manifest.kodeRute,smuNumber:manifest.items[0].smuNumber,smuNumbers:manifest.items.map(i=>i.smuNumber),smuMode:manifest.smuMode,updatedAt:manifest.updatedAt,updatedBy:manifest.updatedBy};return store().get(`booking/${id}`,{type:'json',consistency:'strong'});}
export async function setBookingSmu(bookingId,smuNumber,actor='admin'){
  const id=clean(bookingId,120),smu=normalizeSmuNumber(smuNumber);if(!id)throw new Error('Booking ID wajib.');const booking=await getBooking(id);if(!booking)throw new Error('Booking tidak ditemukan.');if(!smu){await store().delete(`booking/${id}`).catch(()=>{});return {bookingId:id,smuNumber:null,removed:true};}
  const t=now(),row={bookingId:id,partnerId:booking.partnerId||null,kodeRute:booking.kodeRute||null,smuNumber:smu,updatedAt:t,updatedBy:clean(actor,100)};await store().setJSON(`booking/${id}`,row);return row;
}
export async function listBookingSmuAssignments(limit=2000){const {blobs}=await store().list({prefix:'manifest/'}),rows=[];for(const b of blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.min(Math.max(1,Number(limit)||2000),3000))){const row=await store().get(b.key,{type:'json'});if(row?.items?.length)rows.push({bookingId:row.bookingId,partnerId:row.partnerId,kodeRute:row.kodeRute,smuNumber:row.items[0].smuNumber,smuNumbers:row.items.map(i=>i.smuNumber),smuMode:row.smuMode,updatedAt:row.updatedAt,updatedBy:row.updatedBy});}return rows;}
export async function bookingSmuMap(){return new Map((await listBookingSmuAssignments(3000)).map(r=>[r.bookingId,r]));}
