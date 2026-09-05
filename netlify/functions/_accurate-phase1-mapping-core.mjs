import { getStore } from '@netlify/blobs';
import { writeAdminAudit } from './_admin-audit-core.mjs';

const STORE='libra-accurate-phase1-mappings';
const store=()=>getStore(STORE);
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const now=()=>new Date().toISOString();
const allowedRole=session=>['SUPERADMIN','FINANCE'].includes(upper(session?.role));

export function phase1PayerMappingKey(bookingId,payer={}){
  const partnerId=clean(payer?.partnerId,120);if(partnerId)return `PARTNER:${partnerId.toUpperCase()}`;
  return `BOOKING:${clean(bookingId,120).toUpperCase()}`;
}
function customerKey(scopeKey){return `customer/${encodeURIComponent(scopeKey)}`;}
function itemKey(lineCode){return `item/${encodeURIComponent(upper(lineCode))}`;}
const taxKey='tax-policy/current';

export async function getPhase1AccurateMappings({bookingId,payer,lineCodes=[]}={}){
  const payerKey=phase1PayerMappingKey(bookingId,payer),customer=await store().get(customerKey(payerKey),{type:'json',consistency:'strong'}),items={};
  for(const code of [...new Set((lineCodes||[]).map(upper).filter(Boolean))])items[code]=await store().get(itemKey(code),{type:'json',consistency:'strong'});
  const taxPolicy=await store().get(taxKey,{type:'json',consistency:'strong'});
  return {payerKey,customer:customer||null,items,taxPolicy:taxPolicy||null};
}

export async function setPhase1AccurateCustomerMapping({bookingId,payer,customerNo,customerName,session,request}={}){
  if(!allowedRole(session)){const e=new Error('Hanya FINANCE/SUPERADMIN yang dapat mengubah mapping customer Accurate.');e.httpStatus=403;throw e;}
  const payerKey=phase1PayerMappingKey(bookingId,payer),no=clean(customerNo,120);if(!no)throw new Error('customerNo Accurate wajib diisi.');const key=customerKey(payerKey),before=await store().get(key,{type:'json',consistency:'strong'}),mappedAt=now(),after={type:'CUSTOMER_MAPPING',payerKey,bookingId:payer?.partnerId?null:clean(bookingId,120),partnerId:clean(payer?.partnerId,120)||null,payerName:clean(payer?.name,200)||null,customerNo:no,customerName:clean(customerName,240)||null,status:'ACTIVE',mappedAt,mappedBy:clean(session?.username,100)};
  await store().setJSON(key,after);await writeAdminAudit({session,request,action:'PHASE1_ACCURATE_CUSTOMER_MAP',entityType:'ACCURATE_MAPPING',entityId:payerKey,before,after,note:'Mapping payer Tahap 1 ke customerNo Accurate. Mapping tetap diverifikasi read-only terhadap master Accurate sebelum payload siap.'});return after;
}

export async function clearPhase1AccurateCustomerMapping({bookingId,payer,session,request}={}){
  if(!allowedRole(session)){const e=new Error('Hanya FINANCE/SUPERADMIN yang dapat menghapus mapping customer Accurate.');e.httpStatus=403;throw e;}
  const payerKey=phase1PayerMappingKey(bookingId,payer),key=customerKey(payerKey),before=await store().get(key,{type:'json',consistency:'strong'});if(before)await store().delete(key);await writeAdminAudit({session,request,action:'PHASE1_ACCURATE_CUSTOMER_MAP_CLEAR',entityType:'ACCURATE_MAPPING',entityId:payerKey,before,after:null,note:'Mapping customer Accurate dihapus; readiness kembali memakai exact-match saja.'});return {cleared:Boolean(before),payerKey};
}

export async function setPhase1AccurateItemMapping({lineCode,itemNo,itemName,session,request}={}){
  if(!allowedRole(session)){const e=new Error('Hanya FINANCE/SUPERADMIN yang dapat mengubah mapping item/jasa Accurate.');e.httpStatus=403;throw e;}
  const code=upper(lineCode),no=clean(itemNo,120);if(!code||!no)throw new Error('lineCode dan itemNo Accurate wajib diisi.');const key=itemKey(code),before=await store().get(key,{type:'json',consistency:'strong'}),mappedAt=now(),after={type:'ITEM_MAPPING',lineCode:code,itemNo:no,itemName:clean(itemName,240)||null,status:'ACTIVE',mappedAt,mappedBy:clean(session?.username,100)};await store().setJSON(key,after);await writeAdminAudit({session,request,action:'PHASE1_ACCURATE_ITEM_MAP',entityType:'ACCURATE_MAPPING',entityId:code,before,after,note:'Mapping line invoice Tahap 1 ke item/jasa Accurate. Mapping diverifikasi ulang terhadap master Accurate sebelum payload siap.'});return after;
}

export async function clearPhase1AccurateItemMapping({lineCode,session,request}={}){
  if(!allowedRole(session)){const e=new Error('Hanya FINANCE/SUPERADMIN yang dapat menghapus mapping item/jasa Accurate.');e.httpStatus=403;throw e;}
  const code=upper(lineCode),key=itemKey(code),before=await store().get(key,{type:'json',consistency:'strong'});if(before)await store().delete(key);await writeAdminAudit({session,request,action:'PHASE1_ACCURATE_ITEM_MAP_CLEAR',entityType:'ACCURATE_MAPPING',entityId:code,before,after:null});return {cleared:Boolean(before),lineCode:code};
}

export async function setPhase1AccurateTaxPolicy({mode,session,request,note}={}){
  if(!allowedRole(session)){const e=new Error('Hanya FINANCE/SUPERADMIN yang dapat mengonfirmasi policy pajak Native SI.');e.httpStatus=403;throw e;}
  const normalized=upper(mode);if(!['ITEM_MASTER_DEFAULTS_CONFIRMED','REVIEW_REQUIRED'].includes(normalized))throw new Error('Mode tax policy tidak valid.');const before=await store().get(taxKey,{type:'json',consistency:'strong'}),confirmed=normalized==='ITEM_MASTER_DEFAULTS_CONFIRMED',after={mode:normalized,confirmed,status:confirmed?'CONFIRMED':'REVIEW_REQUIRED',confirmedAt:confirmed?now():null,confirmedBy:confirmed?clean(session?.username,100):null,updatedAt:now(),updatedBy:clean(session?.username,100),note:clean(note,500)||null};await store().setJSON(taxKey,after);await writeAdminAudit({session,request,action:'PHASE1_ACCURATE_TAX_POLICY',entityType:'ACCURATE_MAPPING',entityId:'TAX_POLICY',before,after,note:confirmed?'Finance mengonfirmasi Native SI memakai konfigurasi pajak dari master item/jasa Accurate.':'Tax policy dikembalikan ke REVIEW_REQUIRED.'});return after;
}
