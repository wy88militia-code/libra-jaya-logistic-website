import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking } from './_booking-core.mjs';
import { getVerifiedOperationalWeight } from './_weight-core.mjs';
import { normalizePartnerId } from './_partner-core.mjs';

const STORE='libra-weight-approvals';
const store=()=>getStore(STORE);
const clean=(v,n=400)=>String(v??'').trim().slice(0,n);
const kg=v=>Math.round(Number(v||0)*100)/100;
const now=()=>new Date().toISOString();
const latestKey=id=>`latest/${clean(id,120)}`;
const historyKey=(id,fingerprint,t,approvalId)=>`history/${clean(id,120)}/${fingerprint}/${t}-${approvalId}`;
const headKey=id=>`head/${clean(id,120)}`;
const eventKey=(id,t,eventId)=>`event/${clean(id,120)}/${t}-${eventId}`;
const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');

export function weightFingerprint(weight={}){
  if(!weight?.bookingId)return null;
  const payload={
    bookingId:clean(weight.bookingId,120),
    verifiedAt:clean(weight.verifiedAt,60),
    reweighCount:Number(weight.reweighCount||0),
    customerDeclaredWeightKg:kg(weight.customerDeclaredWeightKg),
    finalChargeableWeightKg:kg(weight.libraFinalChargeableWeightKg??weight.chargeableWeightKg),
    weightDeltaKg:kg(weight.weightDeltaKg),
    weightStatus:clean(weight.weightStatus,40).toUpperCase(),
    ruleVersion:clean(weight.ruleVersion,60),
  };
  return sha(JSON.stringify(payload));
}
function stableEventHash(event){const copy={...event};delete copy.eventHash;return sha(JSON.stringify(copy));}
async function appendEvent(bookingId,type,actor,metadata={}){
  const head=await store().get(headKey(bookingId),{type:'json',consistency:'strong'}),createdAt=now(),event={eventId:`WAP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,bookingId:clean(bookingId,120),type:clean(type,60).toUpperCase(),actor:clean(actor,100)||null,metadata,previousEventHash:head?.eventHash||null,createdAt};event.eventHash=stableEventHash(event);await store().setJSON(eventKey(bookingId,createdAt,event.eventId),event,{onlyIfNew:true});await store().setJSON(headKey(bookingId),{eventId:event.eventId,eventHash:event.eventHash,createdAt});return event;
}

export async function getWeightApprovalState(bookingId){
  const id=clean(bookingId,120);if(!id)return {bookingId:id,status:'NO_BOOKING_ID',approvalRequired:false,continuationAllowed:false};
  const [booking,weight,latest]=await Promise.all([getBooking(id),getVerifiedOperationalWeight(id),store().get(latestKey(id),{type:'json',consistency:'strong'})]);
  if(!booking)return {bookingId:id,status:'BOOKING_NOT_FOUND',approvalRequired:false,continuationAllowed:false};
  if(!weight)return {bookingId:id,partnerId:booking.partnerId||null,status:'WEIGHT_NOT_VERIFIED',approvalRequired:false,continuationAllowed:false,booking};
  const fingerprint=weightFingerprint(weight),adjustment=String(weight.weightStatus||'').toUpperCase()==='WEIGHT_ADJUSTMENT'||Boolean(weight.billingReviewRequired);
  if(!adjustment)return {bookingId:id,partnerId:booking.partnerId||null,status:'CLEAR',approvalRequired:false,continuationAllowed:true,fingerprint,weight,booking,approval:null};
  const matching=latest&&latest.fingerprint===fingerprint?latest:null,approved=matching?.decision==='APPROVED';
  return {bookingId:id,partnerId:booking.partnerId||null,status:matching?.decision||'PENDING_APPROVAL',approvalRequired:true,continuationAllowed:approved,fingerprint,weight,booking,approval:matching};
}

export async function decideWeightAdjustment(input={},partner={}){
  const bookingId=clean(input.bookingId,120),partnerId=normalizePartnerId(partner?.partnerId),decision=clean(input.decision,20).toUpperCase(),note=clean(input.note,500),expectedFingerprint=clean(input.fingerprint,128);
  if(!bookingId||!partnerId)throw new Error('Booking/partner tidak valid.');if(!['APPROVED','REJECTED'].includes(decision))throw new Error('Keputusan approval tidak valid.');
  const state=await getWeightApprovalState(bookingId);if(!state.booking)throw new Error('Booking tidak ditemukan.');if(normalizePartnerId(state.booking.partnerId)!==partnerId)throw new Error('Booking ini bukan milik partner yang sedang login.');if(!state.approvalRequired)throw new Error('Booking tidak memerlukan persetujuan selisih berat.');if(!expectedFingerprint||expectedFingerprint!==state.fingerprint)throw new Error('Data timbang telah berubah. Muat ulang halaman sebelum memberi keputusan.');
  if(state.approval?.fingerprint===state.fingerprint&&state.approval?.decision===decision)return {...state.approval,idempotent:true};
  const createdAt=now(),approvalId=`WAPR-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,row={approvalId,bookingId,partnerId,fingerprint:state.fingerprint,decision,customerDeclaredWeightKg:kg(state.weight.customerDeclaredWeightKg),libraFinalChargeableWeightKg:kg(state.weight.libraFinalChargeableWeightKg??state.weight.chargeableWeightKg),weightDeltaKg:kg(state.weight.weightDeltaKg),weightStatus:state.weight.weightStatus,ruleVersion:state.weight.ruleVersion||null,verifiedAt:state.weight.verifiedAt,reweighCount:Number(state.weight.reweighCount||0),note:note||null,decidedAt:createdAt,decidedByPartnerId:partnerId,source:'AUTHENTICATED_PARTNER_PORTAL'};
  await store().setJSON(historyKey(bookingId,state.fingerprint,createdAt,approvalId),row,{onlyIfNew:true});await store().setJSON(latestKey(bookingId),row);await appendEvent(bookingId,decision==='APPROVED'?'WEIGHT_ADJUSTMENT_APPROVED':'WEIGHT_ADJUSTMENT_REJECTED',partnerId,{approvalId,fingerprint:state.fingerprint,weightDeltaKg:row.weightDeltaKg,finalChargeableWeightKg:row.libraFinalChargeableWeightKg});return row;
}

export async function assertWeightApprovedForContinuation(bookingId){
  const state=await getWeightApprovalState(bookingId);if(!state.weight)throw new Error(`Booking ${bookingId} belum memiliki verified weight.`);if(state.continuationAllowed)return state;
  if(state.status==='REJECTED')throw new Error(`Booking ${bookingId}: customer menolak penyesuaian berat terbaru.`);
  if(state.approvalRequired)throw new Error(`Booking ${bookingId}: selisih berat ≥0,20 kg menunggu approval customer/partner.`);
  throw new Error(`Booking ${bookingId}: berat belum memenuhi syarat untuk dilanjutkan.`);
}

export async function listWeightApprovalEvents(bookingId,limit=200){const {blobs}=await store().list({prefix:`event/${clean(bookingId,120)}/`}),rows=[];for(const b of blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-Math.min(Math.max(1,Number(limit)||200),500))){const r=await store().get(b.key,{type:'json'});if(r)rows.push(r);}return rows;}
export async function verifyWeightApprovalChain(bookingId){const rows=await listWeightApprovalEvents(bookingId,500);let previous=null;for(const row of rows){if((row.previousEventHash||null)!==previous)return {ok:false,eventId:row.eventId,reason:'PREVIOUS_HASH_MISMATCH'};if(stableEventHash(row)!==row.eventHash)return {ok:false,eventId:row.eventId,reason:'EVENT_HASH_MISMATCH'};previous=row.eventHash;}return {ok:true,count:rows.length,headHash:previous};}
