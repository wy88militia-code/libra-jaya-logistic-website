import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBookingWithMetadata, saveBooking } from './_booking-core.mjs';
import { getPhase1FinalPricingReadiness } from './_phase1-final-pricing-core.mjs';
import { writeAdminAudit } from './_admin-audit-core.mjs';

const STORE='libra-phase1-price-locks';
const store=()=>getStore(STORE);
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const now=()=>new Date().toISOString();
const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value);}
function fingerprint(readiness){
  const payload={bookingId:readiness.bookingId,serviceCode:readiness.serviceCode,routeCode:readiness.routeCode,finalWeightKg:readiness.finalWeightKg,customerChargeableKg:readiness.customerChargeableKg,weightFingerprint:readiness.weightApproval?.fingerprint||null,ptpMarginPct:readiness.selling.ptpMarginPct,ptpSellRatePerKg:readiness.selling.ptpSellRatePerKg,lastmileRatePerKg:readiness.selling.lastmileRatePerKg,ptpFreight:readiness.selling.ptpFreight,lastmileFreight:readiness.selling.lastmileFreight,insuranceRatePercent:readiness.selling.insuranceRatePercent,insuranceAmount:readiness.selling.insuranceAmount,total:readiness.selling.total,airlineRateId:readiness.costReference.airlineRateId,airlineRatePerKg:readiness.costReference.airlineRatePerKg,configSource:readiness.config.source};
  return sha(canonical(payload));
}

export async function lockPhase1FinalPrice({bookingId,session,request}={}){
  if(String(session?.role||'').toUpperCase()!=='SUPERADMIN'){const e=new Error('Hanya SUPERADMIN yang dapat mengunci harga final Tahap 1.');e.httpStatus=403;throw e;}
  const id=clean(bookingId,120);if(!id)throw new Error('Booking ID wajib.');
  const readiness=await getPhase1FinalPricingReadiness(id);if(!readiness.ready)throw new Error(`Harga belum dapat dikunci: ${(readiness.reasons||[]).map(x=>x.code).join(', ')||'pricing gate belum READY'}.`);
  const entry=await getBookingWithMetadata(id),booking=entry?.data;if(!booking)throw new Error('Booking tidak ditemukan.');
  const fp=fingerprint(readiness),existing=booking.finalPriceLock||null;
  if(existing?.fingerprint===fp&&String(booking.pricingStatus||'').toUpperCase()==='FINAL_PRICE_LOCKED')return {booking,lock:existing,idempotent:true,readiness};
  if(existing?.fingerprint&&existing.fingerprint!==fp)throw new Error('Booking sudah memiliki harga final berbeda. Repricing harus melalui workflow koreksi/approval terpisah; lock lama tidak boleh ditimpa.');
  const lockedAt=now(),lockId=`P1LOCK-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,lock={lockId,bookingId:id,fingerprint:fp,status:'LOCKED',serviceCode:readiness.serviceCode,routeCode:readiness.routeCode,finalWeightKg:readiness.finalWeightKg,customerChargeableKg:readiness.customerChargeableKg,weightFingerprint:readiness.weightApproval?.fingerprint||null,selling:{...readiness.selling},costReference:{airlineRateId:readiness.costReference.airlineRateId,airlineId:readiness.costReference.airlineId,airlineName:readiness.costReference.airlineName,airlineRatePerKg:readiness.costReference.airlineRatePerKg,vendorMinKg:readiness.costReference.vendorMinKg,adminPerUniqueSmu:readiness.costReference.adminPerUniqueSmu},config:{...readiness.config},lockedAt,lockedBy:clean(session.username,100)};
  const next={...booking,amount:Number(readiness.selling.total),chargeableWeightKg:Number(readiness.customerChargeableKg),pricingStatus:'FINAL_PRICE_LOCKED',billingStatus:'READY_TO_INVOICE',finalPriceLock:lock,financeGate:{...(booking.financeGate||{}),status:'FINAL_PRICE_LOCKED',autoPost:false,reason:'PRICE_LOCKED_WAIT_INVOICE_POSTING'},updatedAt:lockedAt};
  const saved=await saveBooking(next,{onlyIfMatch:entry.etag});if(!saved.modified)throw new Error('Booking berubah di proses lain. Refresh lalu ulangi lock harga.');
  await store().setJSON(`lock/${id}/${fp}`,lock,{onlyIfNew:true}).catch(()=>{});await store().setJSON(`latest/${id}`,{lockId,fingerprint:fp,lockedAt,lockedBy:lock.lockedBy,status:'LOCKED'}).catch(()=>{});
  await writeAdminAudit({session,request,action:'PHASE1_FINAL_PRICE_LOCK',entityType:'BOOKING',entityId:id,before:{amount:booking.amount,pricingStatus:booking.pricingStatus,billingStatus:booking.billingStatus,financeGate:booking.financeGate},after:{amount:next.amount,pricingStatus:next.pricingStatus,billingStatus:next.billingStatus,lockId,fingerprint:fp},note:'Lock harga final Tahap 1 CGK-DJJ-last-mile. Wallet dan Accurate belum diposting.',metadata:{serviceCode:readiness.serviceCode,routeCode:readiness.routeCode,finalWeightKg:readiness.finalWeightKg,ptpMarginPct:readiness.selling.ptpMarginPct,ptpSellRatePerKg:readiness.selling.ptpSellRatePerKg,lastmileRatePerKg:readiness.selling.lastmileRatePerKg,insuranceAmount:readiness.selling.insuranceAmount}});
  return {booking:next,lock,readiness,idempotent:false};
}

export async function getPhase1FinalPriceLock(bookingId){const id=clean(bookingId,120);const latest=await store().get(`latest/${id}`,{type:'json',consistency:'strong'});if(!latest?.fingerprint)return null;return store().get(`lock/${id}/${latest.fingerprint}`,{type:'json',consistency:'strong'});}
