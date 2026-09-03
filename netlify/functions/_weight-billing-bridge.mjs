import { getStore } from '@netlify/blobs';

const STORE='libra-billing';
const store=()=>getStore(STORE);
const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
const kg=v=>Math.round(Number(v||0)*100)/100;
const now=()=>new Date().toISOString();
const key=(bookingId,reweighCount)=>`weight-review/${clean(bookingId,120)}/${String(Math.max(1,Number(reweighCount)||1)).padStart(6,'0')}`;

export async function queueWeightBillingReview(input={}){
 const bookingId=clean(input.bookingId,120),partnerId=clean(input.partnerId,120);if(!bookingId)throw new Error('Booking ID review wajib.');
 const reweighCount=Math.max(1,Math.trunc(Number(input.reweighCount)||1)),reviewKey=key(bookingId,reweighCount);
 const existing=await store().get(reviewKey,{type:'json',consistency:'strong'});if(existing)return existing;
 const row={reviewId:`WBR-${bookingId}-${String(reweighCount).padStart(4,'0')}`,bookingId,partnerId:partnerId||null,reweighCount,declaredWeightKg:kg(input.declaredWeightKg),previousChargeableWeightKg:input.previousChargeableWeightKg==null?null:kg(input.previousChargeableWeightKg),actualWeightKg:kg(input.actualWeightKg),volumetricWeightKg:kg(input.volumetricWeightKg),chargeableWeightKg:kg(input.chargeableWeightKg),varianceKg:kg(input.varianceKg),variancePct:input.variancePct==null?null:Number(input.variancePct),status:'PENDING_APPROVAL',requiresMakerChecker:true,walletMutationAllowed:false,reason:clean(input.reason,500)||null,scaleId:clean(input.scaleId,120)||null,createdAt:now(),createdBy:clean(input.actor,100)||null};
 await store().setJSON(reviewKey,row,{onlyIfNew:true});return row;
}

export async function listWeightBillingReviews(status='PENDING_APPROVAL',limit=500){const {blobs}=await store().list({prefix:'weight-review/'}),rows=[];for(const b of blobs.slice(0,Math.min(2000,Math.max(1,Number(limit)||500)))){const r=await store().get(b.key,{type:'json'});if(r&&(!status||r.status===status))rows.push(r);}return rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));}
