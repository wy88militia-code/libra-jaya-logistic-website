import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking } from './_booking-core.mjs';
import { classifyOutgoingWeight, LOGISTICS_RULE_VERSION } from './_logistics-rule-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';

const STORE='libra-weights';
const MANIFEST_STORE='libra-manifests';
const store=()=>getStore(STORE);
const manifestStore=()=>getStore(MANIFEST_STORE);
const clean=(v,m=180)=>String(v??'').trim().slice(0,m);
const now=()=>new Date().toISOString();
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const kg=v=>Math.round(Number(v||0)*100)/100;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const key=id=>`weight/${clean(id,120)}`;
const eventKey=(id,t,eid)=>`event/${clean(id,120)}/${t}-${eid}`;
const stable=v=>{const x={...v};delete x.eventHash;return sha(JSON.stringify(x));};

export async function getWeightRecord(id){return store().get(key(id),{type:'json',consistency:'strong'});}
export async function getWeightRecordWithMetadata(id){return store().getWithMetadata(key(id),{type:'json',consistency:'strong'});}
export async function listWeightRecords(limit=300){const {blobs}=await store().list({prefix:'weight/'}),rows=[];for(const b of blobs.slice(0,Math.min(1000,limit))){const r=await store().get(b.key,{type:'json'});if(r)rows.push(r);}return rows.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));}

async function activeManifestForBooking(bookingId){const id=await manifestStore().get(`active-booking/${clean(bookingId,120)}`,{type:'text',consistency:'strong'});if(!id)return null;const manifest=await manifestStore().get(`manifest/${id}`,{type:'json',consistency:'strong'});return manifest?{manifestId:id,status:String(manifest.status||'').toUpperCase()}:null;}

async function appendEvent(record,input={}){const head=await store().get(`head/${record.bookingId}`,{type:'json',consistency:'strong'}),createdAt=now();const event={eventId:`WGT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,bookingId:record.bookingId,type:clean(input.type,60).toUpperCase(),actor:clean(input.actor,100)||null,actualWeightKg:kg(input.actualWeightKg),volumetricWeightKg:kg(input.volumetricWeightKg),chargeableWeightKg:kg(input.chargeableWeightKg),weightDeltaKg:kg(record.weightDeltaKg),weightStatus:clean(record.weightStatus,40)||null,weightBasis:clean(record.weightBasis,40)||null,ruleVersion:clean(record.ruleVersion,40)||null,reason:clean(input.reason,500)||null,scaleId:clean(input.scaleId,120)||null,billingReviewStatus:clean(record.billingReviewStatus,40)||null,previousEventHash:head?.eventHash||null,createdAt};event.eventHash=stable(event);await store().setJSON(eventKey(record.bookingId,createdAt,event.eventId),event,{onlyIfNew:true});await store().setJSON(`head/${record.bookingId}`,{eventId:event.eventId,eventHash:event.eventHash,createdAt});return event;}

function calcVolumetric(i={}){const l=num(i.lengthCm),w=num(i.widthCm),h=num(i.heightCm),pieces=Math.max(1,Math.trunc(Number(i.packageCount||1))),divisor=Math.max(1,Math.trunc(Number(i.volumetricDivisor||6000)));if(!(l>0&&w>0&&h>0))return 0;return kg((l*w*h*pieces)/divisor);}

export async function getVerifiedOperationalWeight(bookingId){const r=await getWeightRecord(bookingId);if(!r||r.status!=='VERIFIED')return null;return {bookingId:r.bookingId,customerDeclaredWeightKg:r.customerDeclaredWeightKg??r.declaredWeightKg,actualWeightKg:r.actualWeightKg,libraActualWeightKg:r.libraActualWeightKg??r.actualWeightKg,volumetricWeightKg:r.volumetricWeightKg,libraVolumeWeightKg:r.libraVolumeWeightKg??r.volumetricWeightKg,chargeableWeightKg:r.chargeableWeightKg,libraFinalChargeableWeightKg:r.libraFinalChargeableWeightKg??r.chargeableWeightKg,weightBasis:r.weightBasis||'LIBRA_VERIFIED',weightDeltaKg:r.weightDeltaKg??kg(Math.abs(Number(r.chargeableWeightKg||0)-Number(r.declaredWeightKg||0))),weightStatus:r.weightStatus||(Boolean(r.billingReviewRequired)?'WEIGHT_ADJUSTMENT':'CLEAR'),ruleVersion:r.ruleVersion||null,packageCount:r.packageCount,verifiedAt:r.updatedAt,reweighCount:r.reweighCount,billingReviewRequired:Boolean(r.billingReviewRequired),billingReviewStatus:r.billingReviewStatus||'NONE'};}

export async function recordReweigh(input={},actor='admin'){
 const bookingId=clean(input.bookingId,120);if(!bookingId)throw new Error('Booking ID wajib.');const booking=await getBooking(bookingId);if(!booking)throw new Error('Booking tidak ditemukan.');
 const manifest=await activeManifestForBooking(bookingId);if(manifest&&manifest.status!=='OPEN')throw new Error(`Reweigh dikunci karena booking aktif di manifest ${manifest.manifestId} berstatus ${manifest.status}.`);
 const actual=num(input.actualWeightKg);if(!(actual>0&&actual<=100000))throw new Error('Actual weight tidak valid.');
 const scaleId=clean(input.scaleId,120);if(!scaleId)throw new Error('Scale ID wajib untuk verifikasi berat.');
 const packageCount=Math.max(1,Math.trunc(Number(input.packageCount||booking.packageCount||booking.koli||1)));
 const volumetricDivisor=Math.max(1,Math.trunc(Number(input.volumetricDivisor||6000)));
 const volumetricWeightKg=calcVolumetric({...input,packageCount,volumetricDivisor});
 const chargeableWeightKg=kg(Math.max(actual,volumetricWeightKg));
 const previous=await getWeightRecordWithMetadata(bookingId),prev=previous?.data||null;
 const reason=clean(input.reason,500);if(prev&&!reason)throw new Error('Alasan wajib untuk reweigh setelah verifikasi pertama.');
 const declaredWeightKg=kg(Number(booking.weightKg||0));
 const varianceKg=kg(actual-declaredWeightKg),variancePct=declaredWeightKg>0?Math.round((varianceKg/declaredWeightKg)*10000)/100:null;
 const weightDecision=classifyOutgoingWeight(declaredWeightKg,chargeableWeightKg);
 const billingVarianceKg=kg(chargeableWeightKg-declaredWeightKg);
 const billingReviewRequired=weightDecision.customerReapprovalRequired;
 const billingReviewStatus=billingReviewRequired?'REQUIRED':'NONE';
 const reweighCount=Number(prev?.reweighCount||0)+1;
 const t=now(),record={bookingId,declaredWeightKg,customerDeclaredWeightKg:declaredWeightKg,actualWeightKg:kg(actual),libraActualWeightKg:kg(actual),volumetricWeightKg,libraVolumeWeightKg:volumetricWeightKg,chargeableWeightKg,libraFinalChargeableWeightKg:chargeableWeightKg,weightBasis:'LIBRA_VERIFIED',weightDeltaKg:weightDecision.weightDeltaKg,weightStatus:weightDecision.weightStatus,customerReapprovalRequired:weightDecision.customerReapprovalRequired,weightClearThresholdKg:weightDecision.thresholdKg,ruleVersion:LOGISTICS_RULE_VERSION,billingVarianceKg,packageCount,lengthCm:num(input.lengthCm),widthCm:num(input.widthCm),heightCm:num(input.heightCm),volumetricDivisor,varianceKg,variancePct,reweighCount,scaleId,reason:reason||null,status:'VERIFIED',billingReviewRequired,billingReviewStatus,billingAdjustmentApplied:false,manifestLock:manifest||null,createdAt:prev?.createdAt||t,createdBy:prev?.createdBy||clean(actor,100),updatedAt:t,updatedBy:clean(actor,100)};
 const result=await store().setJSON(key(bookingId),record,previous?.etag?{onlyIfMatch:previous.etag}:{onlyIfNew:true});if(!result.modified)throw new Error('Data timbang berubah di proses lain. Refresh lalu coba lagi.');await appendEvent(record,{type:prev?'REWEIGH_RECORDED':'WEIGHT_VERIFIED',actor,actualWeightKg:record.actualWeightKg,volumetricWeightKg,chargeableWeightKg,reason:record.reason,scaleId:record.scaleId});
 if(billingReviewRequired&&booking.partnerId){try{await createOperationalNotification({partnerId:booking.partnerId,type:'WEIGHT_ADJUSTMENT_APPROVAL_REQUIRED',severity:'WARNING',title:'Konfirmasi berat final diperlukan',message:`Booking ${bookingId}: berat booking ${declaredWeightKg.toFixed(2)} kg, final Libra ${chargeableWeightKg.toFixed(2)} kg, selisih ${weightDecision.weightDeltaKg.toFixed(2)} kg. Persetujuan diperlukan sebelum kiriman dilanjutkan.`,reference:bookingId,partnerLink:`/partner/weight-approval?booking=${encodeURIComponent(bookingId)}`,adminLink:`/admin-weights?booking=${encodeURIComponent(bookingId)}`,dedupeKey:`weight-approval:${bookingId}:${record.updatedAt}`,metadata:{bookingId,declaredWeightKg,finalChargeableWeightKg:chargeableWeightKg,weightDeltaKg:weightDecision.weightDeltaKg,reweighCount,ruleVersion:LOGISTICS_RULE_VERSION}});}catch{}}
 return record;
}

export async function listWeightEvents(id,limit=200){const {blobs}=await store().list({prefix:`event/${clean(id,120)}/`}),rows=[];for(const b of blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-Math.min(limit,500))){const r=await store().get(b.key,{type:'json'});if(r)rows.push(r);}return rows;}
export async function verifyWeightChain(id){const rows=await listWeightEvents(id,500);let p=null;for(const r of rows){if((r.previousEventHash||null)!==p)return {ok:false,eventId:r.eventId,reason:'PREVIOUS_HASH_MISMATCH'};if(stable(r)!==r.eventHash)return {ok:false,eventId:r.eventId,reason:'EVENT_HASH_MISMATCH'};p=r.eventHash;}return {ok:true,count:rows.length,headHash:p};}
