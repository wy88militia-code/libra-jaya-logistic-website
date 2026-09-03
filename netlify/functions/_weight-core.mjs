import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking } from './_booking-core.mjs';

const STORE='libra-weights';
const store=()=>getStore(STORE);
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

async function appendEvent(record,input={}){const head=await store().get(`head/${record.bookingId}`,{type:'json',consistency:'strong'}),createdAt=now();const event={eventId:`WGT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,bookingId:record.bookingId,type:clean(input.type,60).toUpperCase(),actor:clean(input.actor,100)||null,actualWeightKg:kg(input.actualWeightKg),volumetricWeightKg:kg(input.volumetricWeightKg),chargeableWeightKg:kg(input.chargeableWeightKg),reason:clean(input.reason,500)||null,scaleId:clean(input.scaleId,120)||null,previousEventHash:head?.eventHash||null,createdAt};event.eventHash=stable(event);await store().setJSON(eventKey(record.bookingId,createdAt,event.eventId),event,{onlyIfNew:true});await store().setJSON(`head/${record.bookingId}`,{eventId:event.eventId,eventHash:event.eventHash,createdAt});return event;}

function calcVolumetric(i={}){const l=num(i.lengthCm),w=num(i.widthCm),h=num(i.heightCm),pieces=Math.max(1,Math.trunc(Number(i.packageCount||1))),divisor=Math.max(1,Math.trunc(Number(i.volumetricDivisor||6000)));if(!(l>0&&w>0&&h>0))return 0;return kg((l*w*h*pieces)/divisor);}

export async function recordReweigh(input={},actor='admin'){
 const bookingId=clean(input.bookingId,120);if(!bookingId)throw new Error('Booking ID wajib.');const booking=await getBooking(bookingId);if(!booking)throw new Error('Booking tidak ditemukan.');
 const actual=num(input.actualWeightKg);if(!(actual>0&&actual<=100000))throw new Error('Actual weight tidak valid.');
 const packageCount=Math.max(1,Math.trunc(Number(input.packageCount||booking.packageCount||booking.koli||1)));
 const volumetricDivisor=Math.max(1,Math.trunc(Number(input.volumetricDivisor||6000)));
 const volumetricWeightKg=calcVolumetric({...input,packageCount,volumetricDivisor});
 const chargeableWeightKg=kg(Math.max(actual,volumetricWeightKg));
 const previous=await getWeightRecordWithMetadata(bookingId),prev=previous?.data||null;
 const declaredWeightKg=kg(Number(booking.weightKg||0));
 const varianceKg=kg(actual-declaredWeightKg),variancePct=declaredWeightKg>0?Math.round((varianceKg/declaredWeightKg)*10000)/100:null;
 const reweighCount=Number(prev?.reweighCount||0)+1;
 const t=now(),record={bookingId,declaredWeightKg,actualWeightKg:kg(actual),volumetricWeightKg,chargeableWeightKg,packageCount,lengthCm:num(input.lengthCm),widthCm:num(input.widthCm),heightCm:num(input.heightCm),volumetricDivisor,varianceKg,variancePct,reweighCount,scaleId:clean(input.scaleId,120)||null,reason:clean(input.reason,500)||null,status:'VERIFIED',billingReviewRequired:Math.abs(chargeableWeightKg-declaredWeightKg)>0.01,createdAt:prev?.createdAt||t,createdBy:prev?.createdBy||clean(actor,100),updatedAt:t,updatedBy:clean(actor,100)};
 const result=await store().setJSON(key(bookingId),record,previous?.etag?{onlyIfMatch:previous.etag}:{onlyIfNew:true});if(!result.modified)throw new Error('Data timbang berubah di proses lain. Refresh lalu coba lagi.');await appendEvent(record,{type:prev?'REWEIGH_RECORDED':'WEIGHT_VERIFIED',actor,actualWeightKg:record.actualWeightKg,volumetricWeightKg,chargeableWeightKg,reason:record.reason,scaleId:record.scaleId});return record;
}

export async function listWeightEvents(id,limit=200){const {blobs}=await store().list({prefix:`event/${clean(id,120)}/`}),rows=[];for(const b of blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-Math.min(limit,500))){const r=await store().get(b.key,{type:'json'});if(r)rows.push(r);}return rows;}
export async function verifyWeightChain(id){const rows=await listWeightEvents(id,500);let p=null;for(const r of rows){if((r.previousEventHash||null)!==p)return {ok:false,eventId:r.eventId,reason:'PREVIOUS_HASH_MISMATCH'};if(stable(r)!==r.eventHash)return {ok:false,eventId:r.eventId,reason:'EVENT_HASH_MISMATCH'};p=r.eventHash;}return {ok:true,count:rows.length,headHash:p};}
