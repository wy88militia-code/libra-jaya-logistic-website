import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking, getBookingWithMetadata, saveBooking } from './_booking-core.mjs';
import { getPhase1FinalPriceLock } from './_phase1-price-lock-core.mjs';
import { writeAdminAudit } from './_admin-audit-core.mjs';

const STORE='libra-phase1-invoice-drafts';
const store=()=>getStore(STORE);
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const money=v=>Math.max(0,Math.round(Number(v)||0));
const now=()=>new Date().toISOString();
const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value);}
function draftFingerprint(payload){return sha(canonical(payload));}
function payerFromBooking(booking={}){return booking.partnerId?{type:'PARTNER',partnerId:booking.partnerId,name:clean(booking.partnerName||booking.sender?.name,160)||booking.partnerId,phone:clean(booking.sender?.phone,60)||null,address:clean(booking.sender?.address,500)||null}:{type:'DIRECT_CUSTOMER',partnerId:null,name:clean(booking.sender?.name,160)||'Customer',phone:clean(booking.sender?.phone,60)||null,address:clean(booking.sender?.address,500)||null};}
function invoiceLines(lock){
  const s=lock?.selling||{},lines=[];
  if(money(s.ptpFreight)>0)lines.push({code:'PTP_CGK_DJJ',description:`Freight ${lock.serviceCode||'PTD'} CGK → DJJ`,qty:Number(lock.customerChargeableKg||0),unit:'kg',rate:money(s.ptpSellRatePerKg),amount:money(s.ptpFreight)});
  if(money(s.lastmileFreight)>0)lines.push({code:'DJJ_LASTMILE_V1',description:`Last-mile Hub DJJ/Sentani → ${lock.routeCode||'tujuan'}`,qty:Number(lock.customerChargeableKg||0),unit:'kg',rate:money(s.lastmileRatePerKg),amount:money(s.lastmileFreight)});
  if(money(s.insuranceAmount)>0)lines.push({code:'INSURANCE',description:`Asuransi barang ${Number(s.insuranceRatePercent||0)}%`,qty:1,unit:'shipment',rate:money(s.insuranceAmount),amount:money(s.insuranceAmount),declaredValue:money(s.declaredValue)});
  if(Array.isArray(s.additionalCharges))for(const x of s.additionalCharges){const amount=money(x?.amount);if(amount>0)lines.push({code:clean(x.code,80)||'ADDITIONAL',description:clean(x.description,240)||'Biaya tambahan',qty:Number(x.qty||1),unit:clean(x.unit,40)||'shipment',rate:money(x.rate||amount),amount});}
  return lines;
}

export async function preparePhase1InvoiceDraft({bookingId,session,request}={}){
  const role=String(session?.role||'').toUpperCase();if(!['SUPERADMIN','OPS'].includes(role)){const e=new Error('Hanya OPS/SUPERADMIN yang dapat menyiapkan draft invoice Soetta.');e.httpStatus=403;throw e;}
  const id=clean(bookingId,120);if(!id)throw new Error('Booking ID wajib.');
  const [entry,lock]=await Promise.all([getBookingWithMetadata(id),getPhase1FinalPriceLock(id)]),booking=entry?.data;if(!booking)throw new Error('Booking tidak ditemukan.');if(!lock||lock.status!=='LOCKED')throw new Error('Harga final belum terkunci. Draft invoice tidak dapat dibuat.');
  if(String(booking.pricingStatus||'').toUpperCase()!=='FINAL_PRICE_LOCKED')throw new Error(`Pricing status booking ${booking.pricingStatus||'-'} belum FINAL_PRICE_LOCKED.`);
  if(String(booking.billingStatus||'').toUpperCase()==='INVOICED')throw new Error('Booking sudah berstatus INVOICED; draft baru tidak boleh dibuat.');
  const lines=invoiceLines(lock),subtotal=lines.reduce((s,x)=>s+money(x.amount),0),lockedTotal=money(lock.selling?.total);
  if(!(lockedTotal>0))throw new Error('Total harga terkunci tidak valid.');if(subtotal!==lockedTotal)throw new Error(`Invoice line mismatch: subtotal Rp${subtotal.toLocaleString('id-ID')} tidak sama dengan locked total Rp${lockedTotal.toLocaleString('id-ID')}.`);
  const payload={bookingId:id,lockId:lock.lockId,lockFingerprint:lock.fingerprint,payer:payerFromBooking(booking),serviceCode:lock.serviceCode,routeCode:lock.routeCode,customerChargeableKg:lock.customerChargeableKg,lines,subtotal,total:lockedTotal,currency:'IDR',taxPostingStatus:'NOT_POSTED',accurateStatus:'NOT_POSTED'};
  const fp=draftFingerprint(payload),key=`draft/${id}/${fp}`,existing=await store().get(key,{type:'json',consistency:'strong'});if(existing)return {draft:existing,booking,idempotent:true};
  const createdAt=now(),draftId=`P1INV-DRAFT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,draft={draftId,...payload,fingerprint:fp,status:'DRAFT',createdAt,createdBy:clean(session.username,100),note:'Dokumen internal pra-invoice. Belum Sales Invoice Accurate, belum debit wallet, belum bukti pajak.'};
  const savedDraft=await store().setJSON(key,draft,{onlyIfNew:true});if(!savedDraft.modified){const row=await store().get(key,{type:'json',consistency:'strong'});return {draft:row,booking,idempotent:true};}
  const next={...booking,billingStatus:'INVOICE_DRAFT_READY',invoiceDraftId:draftId,invoiceDraftFingerprint:fp,financeGate:{...(booking.financeGate||{}),status:'INVOICE_DRAFT_READY',autoPost:false,reason:'DRAFT_READY_WAIT_FINANCE_ISSUE'},updatedAt:createdAt};
  const savedBooking=await saveBooking(next,{onlyIfMatch:entry.etag});if(!savedBooking.modified){await store().setJSON(key,{...draft,status:'ORPHANED_BOOKING_CONFLICT',orphanedAt:now()}).catch(()=>{});throw new Error('Booking berubah saat draft dibuat. Draft ditandai ORPHANED; refresh dan ulangi.');}
  await store().setJSON(`latest/${id}`,{draftId,fingerprint:fp,key,status:'DRAFT',createdAt,createdBy:draft.createdBy});
  await writeAdminAudit({session,request,action:'PHASE1_INVOICE_DRAFT_PREPARE',entityType:'BOOKING',entityId:id,before:{billingStatus:booking.billingStatus,invoiceDraftId:booking.invoiceDraftId||null},after:{billingStatus:next.billingStatus,invoiceDraftId:draftId,invoiceDraftFingerprint:fp,total:lockedTotal},note:'Draft invoice Tahap 1 dibuat dari immutable final price lock. Tidak ada posting wallet/Accurate.',metadata:{lockId:lock.lockId,lockFingerprint:lock.fingerprint,lineCount:lines.length,total:lockedTotal}});
  return {draft,booking:next,idempotent:false};
}

export async function getPhase1InvoiceDraft(bookingId){const id=clean(bookingId,120),idx=await store().get(`latest/${id}`,{type:'json',consistency:'strong'});if(!idx?.key)return null;return store().get(idx.key,{type:'json',consistency:'strong'});}

export async function listPhase1InvoiceDrafts(limit=300){
  const {blobs}=await store().list({prefix:'latest/'}),selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(Number(limit)||300,1000))),rows=[];
  for(const blob of selected){const idx=await store().get(blob.key,{type:'json'});if(!idx?.key)continue;const draft=await store().get(idx.key,{type:'json'});if(!draft)continue;const [review,booking]=await Promise.all([store().get(`review/${draft.bookingId}/${draft.fingerprint}`,{type:'json'}),getBooking(draft.bookingId)]);rows.push({draft,review:review||null,booking:booking||null});}
  return rows.sort((a,b)=>String(b.draft?.createdAt||'').localeCompare(String(a.draft?.createdAt||'')));
}

export async function reviewPhase1InvoiceDraft({bookingId,session,request,note}={}){
  const role=String(session?.role||'').toUpperCase();if(!['SUPERADMIN','FINANCE'].includes(role)){const e=new Error('Hanya FINANCE/SUPERADMIN yang dapat mereview draft invoice.');e.httpStatus=403;throw e;}
  const id=clean(bookingId,120);if(!id)throw new Error('Booking ID wajib.');const idx=await store().get(`latest/${id}`,{type:'json',consistency:'strong'});if(!idx?.key)throw new Error('Draft invoice tidak ditemukan.');
  const [draft,entry]=await Promise.all([store().get(idx.key,{type:'json',consistency:'strong'}),getBookingWithMetadata(id)]),booking=entry?.data;if(!draft||!booking)throw new Error('Draft/booking tidak ditemukan.');if(draft.status!=='DRAFT')throw new Error(`Draft berstatus ${draft.status}; review baru diblokir.`);if(String(booking.billingStatus||'').toUpperCase()==='INVOICED')throw new Error('Booking sudah INVOICED.');
  const reviewKey=`review/${id}/${draft.fingerprint}`,existing=await store().get(reviewKey,{type:'json',consistency:'strong'});if(existing?.status==='REVIEWED')return {review:existing,draft,booking,idempotent:true};
  const reviewedAt=now(),review={reviewId:`P1REV-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,bookingId:id,draftId:draft.draftId,draftFingerprint:draft.fingerprint,lockId:draft.lockId,total:draft.total,status:'REVIEWED',reviewedAt,reviewedBy:clean(session.username,100),reviewedByRole:role,note:clean(note,500)||null,postingPolicy:'WAIT_NATIVE_ACCURATE_SALES_INVOICE'};
  const saved=await store().setJSON(reviewKey,review,{onlyIfNew:true});if(!saved.modified){const row=await store().get(reviewKey,{type:'json',consistency:'strong'});if(row?.status==='REVIEWED')return {review:row,draft,booking,idempotent:true};throw new Error('Review sedang diproses oleh user lain.');}
  const next={...booking,billingStatus:'FINANCE_REVIEWED_WAIT_NATIVE_SI',financeReview:{reviewId:review.reviewId,draftId:draft.draftId,draftFingerprint:draft.fingerprint,reviewedAt,reviewedBy:review.reviewedBy,status:'REVIEWED'},financeGate:{...(booking.financeGate||{}),status:'FINANCE_REVIEWED_WAIT_NATIVE_SI',autoPost:false,reason:'NATIVE_ACCURATE_SALES_INVOICE_NOT_IMPLEMENTED'},updatedAt:reviewedAt};
  const savedBooking=await saveBooking(next,{onlyIfMatch:entry.etag});if(!savedBooking.modified){await store().setJSON(reviewKey,{...review,status:'ORPHANED_BOOKING_CONFLICT',orphanedAt:now()}).catch(()=>{});throw new Error('Booking berubah saat Finance review. Review ditandai ORPHANED; refresh dan ulangi.');}
  await writeAdminAudit({session,request,action:'PHASE1_INVOICE_DRAFT_REVIEW',entityType:'BOOKING',entityId:id,before:{billingStatus:booking.billingStatus,financeReview:booking.financeReview||null},after:{billingStatus:next.billingStatus,financeReview:next.financeReview},note:'Finance mereview draft Tahap 1. Posting ditahan sampai native Accurate Sales Invoice tersedia.',metadata:{draftId:draft.draftId,draftFingerprint:draft.fingerprint,lockId:draft.lockId,total:draft.total}});
  return {review,draft,booking:next,idempotent:false};
}
