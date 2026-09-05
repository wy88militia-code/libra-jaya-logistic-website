import { getStore } from '@netlify/blobs';

const SYNC_STORE='libra-accurate-sync';
const syncStore=()=>getStore(SYNC_STORE);
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const now=()=>new Date().toISOString();
export const PHASE1_NATIVE_SI_WALLET_SOURCE='PHASE1_NATIVE_SI_SETTLEMENT';
export const LEGACY_AUTO_IGNORED_STATUS='IGNORED';

function markerKey(transactionId){return `auto-event/${clean(transactionId,120)}`;}

export function phase1NativeSiWalletContract(){
  return {
    source:PHASE1_NATIVE_SI_WALLET_SOURCE,
    legacyBookingSourceForbidden:true,
    legacyAutoMarkerStatus:LEGACY_AUTO_IGNORED_STATUS,
    accountingReason:'Revenue recognized by Native Accurate Sales Invoice; wallet movement is settlement only and must not create legacy BOOKING_REVENUE Journal Voucher.',
    failureSafety:'If IGNORE marker cannot be written, dedicated source is unsupported by legacy auto mapping and therefore cannot post BOOKING_REVENUE. It may surface as EXCEPTION for reconciliation.',
  };
}

export async function markPhase1NativeSiSettlementIgnoredForLegacyAuto(transaction={}){
  const transactionId=clean(transaction.transactionId,120);if(!transactionId)throw new Error('transactionId wajib untuk marker anti-double Native SI.');
  const source=clean(transaction.source,80).toUpperCase();if(source!==PHASE1_NATIVE_SI_WALLET_SOURCE)throw new Error(`Marker IGNORED hanya untuk source ${PHASE1_NATIVE_SI_WALLET_SOURCE}.`);
  const existing=await syncStore().get(markerKey(transactionId),{type:'json',consistency:'strong'});if(existing?.status==='POSTED')throw new Error('Legacy Accurate marker sudah POSTED; settlement Native SI diblokir dan wajib direkonsiliasi.');if(existing?.status==='RECONCILE_REQUIRED')throw new Error('Legacy Accurate marker RECONCILE_REQUIRED; settlement Native SI diblokir.');if(existing?.status==='IGNORED')return {...existing,idempotent:true};
  const row={transactionId,partnerId:clean(transaction.partnerId,120)||null,source:PHASE1_NATIVE_SI_WALLET_SOURCE,reference:clean(transaction.reference,160)||null,amount:Math.abs(Math.trunc(Number(transaction.signedAmount)||0)),status:'IGNORED',createdAt:transaction.createdAt||now(),updatedAt:now(),reason:'Native Sales Invoice revenue path. Legacy wallet-event Journal Voucher intentionally suppressed to prevent double revenue.',nativeSalesInvoice:true,duplicateRevenueGuard:true};
  await syncStore().setJSON(markerKey(transactionId),row);return {...row,idempotent:false};
}

export async function getLegacyAutoMarkerForTransaction(transactionId){return syncStore().get(markerKey(transactionId),{type:'json',consistency:'strong'});}

export function verifyPhase1NativeSiWalletContract(){const c=phase1NativeSiWalletContract();return {ok:c.source!=='BOOKING'&&c.legacyAutoMarkerStatus==='IGNORED'&&c.legacyBookingSourceForbidden===true,contract:c};}
