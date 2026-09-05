import { getStore } from '@netlify/blobs';
import { getBookingWithMetadata, saveBooking } from './_booking-core.mjs';
import { getPhase1InvoiceDraft } from './_phase1-invoice-draft-core.mjs';
import { getWallet } from './_partner-core.mjs';
import { writeAdminAudit } from './_admin-audit-core.mjs';
import { phase1NativeSiWalletContract } from './_phase1-native-si-wallet-core.mjs';

const STORE='libra-phase1-native-si-settlement';
const store=()=>getStore(STORE);
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const money=v=>Math.max(0,Math.trunc(Number(v)||0));
const now=()=>new Date().toISOString();

export const PHASE1_SETTLEMENT_MODES=Object.freeze({
  DIRECT_AR:'DIRECT_AR',
  PARTNER_DEPOSIT:'PARTNER_DEPOSIT',
});

function settlementKey(bookingId){return `settlement/${clean(bookingId,120)}`;}
function normalizeAccurateInvoice(invoice={}){return {
  id:invoice.id??invoice.accurateId??null,
  number:clean(invoice.number||invoice.no||invoice.accurateNumber,120)||null,
  customerNo:clean(invoice.customerNo||invoice.customer?.no,120)||null,
  total:money(invoice.total||invoice.totalAmount||invoice.amount),
  databaseName:clean(invoice.databaseName,160)||null,
  branchName:clean(invoice.branchName||invoice.branch?.name,160)||null,
  readBackVerified:invoice.readBackVerified===true,
  postedAt:invoice.postedAt||invoice.executedAt||now(),
};}

export async function getPhase1SettlementState(bookingId){return store().get(settlementKey(bookingId),{type:'json',consistency:'strong'});}

export async function buildPhase1SettlementReadiness(bookingId){
  const id=clean(bookingId,120);if(!id)throw new Error('Booking ID wajib.');
  const [entry,draft,state]=await Promise.all([getBookingWithMetadata(id),getPhase1InvoiceDraft(id),getPhase1SettlementState(id)]),booking=entry?.data;
  if(!booking)throw new Error('Booking tidak ditemukan.');if(!draft)throw new Error('Draft invoice Tahap 1 belum tersedia.');
  const amount=money(draft.total),mode=booking.partnerId?PHASE1_SETTLEMENT_MODES.PARTNER_DEPOSIT:PHASE1_SETTLEMENT_MODES.DIRECT_AR,reasons=[];
  let wallet=null;
  if(mode===PHASE1_SETTLEMENT_MODES.PARTNER_DEPOSIT){
    wallet=await getWallet(booking.partnerId);
    if(money(wallet.balance)<amount)reasons.push({code:'PARTNER_WALLET_INSUFFICIENT',message:`Saldo partner Rp${money(wallet.balance).toLocaleString('id-ID')} lebih kecil dari invoice Rp${amount.toLocaleString('id-ID')}.`});
    reasons.push({code:'PARTNER_DEPOSIT_ACCURATE_DP_BRIDGE_REQUIRED',message:'Saldo wallet Libra saat ini adalah kewajiban Deposit Partner, bukan Faktur Uang Muka Penjualan Accurate. Native SI partner diblokir sampai bridge deposit → Sales Down Payment Accurate tersedia dan dapat direkonsiliasi.'});
  }
  if(mode===PHASE1_SETTLEMENT_MODES.DIRECT_AR&&booking.partnerId)reasons.push({code:'DIRECT_AR_PARTNER_FORBIDDEN',message:'Booking partner tidak boleh diam-diam dialihkan ke Direct AR tanpa policy corporate-credit yang disetujui.'});
  const contract=phase1NativeSiWalletContract();
  return {
    bookingId:id,mode,ready:reasons.length===0,reasons,amount,draftId:draft.draftId,draftFingerprint:draft.fingerprint,payer:draft.payer,
    wallet:mode===PHASE1_SETTLEMENT_MODES.PARTNER_DEPOSIT?{partnerId:booking.partnerId,balance:money(wallet?.balance),sufficient:money(wallet?.balance)>=amount}:null,
    directArPolicy:mode===PHASE1_SETTLEMENT_MODES.DIRECT_AR?{localWalletMutation:false,accurateReceivableAuthoritative:true,localStatusAfterVerifiedSi:'INVOICED_AR_OPEN',collectionPath:'ACCURATE_SALES_RECEIPT_OR_APPROVED_AR_COLLECTION'}:null,
    partnerDepositPolicy:mode===PHASE1_SETTLEMENT_MODES.PARTNER_DEPOSIT?{walletSourceAfterBridge:contract.source,legacyBookingSourceForbidden:true,legacyAutoMarker:'IGNORED',currentBridgeStatus:'BLOCKED_NEEDS_ACCURATE_SALES_DOWNPAYMENT',doNotUseSalesReceiptAgainstGenericWalletDeposit:true}:null,
    existingState:state||null,checkedAt:now(),
  };
}

export async function finalizePhase1DirectArAfterVerifiedNativeSi({bookingId,accurateInvoice,session,request}={}){
  const role=String(session?.role||'').toUpperCase();if(!['SUPERADMIN','FINANCE','SYSTEM'].includes(role)){const e=new Error('Hanya FINANCE/SUPERADMIN atau internal SYSTEM yang dapat finalisasi Direct AR.');e.httpStatus=403;throw e;}
  const id=clean(bookingId,120),readiness=await buildPhase1SettlementReadiness(id);if(readiness.mode!==PHASE1_SETTLEMENT_MODES.DIRECT_AR)throw new Error('Finalisasi ini hanya untuk Direct Customer AR. Partner Deposit memerlukan bridge Sales Down Payment Accurate.');if(!readiness.ready)throw new Error(`Direct AR belum siap: ${(readiness.reasons||[]).map(x=>x.code).join(', ')}.`);
  const invoice=normalizeAccurateInvoice(accurateInvoice);if(!invoice.number&&!invoice.id)throw new Error('Bukti Native Sales Invoice Accurate wajib memiliki id/number.');if(invoice.readBackVerified!==true)throw new Error('Native Sales Invoice wajib lolos read-back verification sebelum booking ditandai piutang terbuka.');if(invoice.total!==readiness.amount)throw new Error(`Total Sales Invoice Rp${invoice.total.toLocaleString('id-ID')} tidak sama dengan draft terkunci Rp${readiness.amount.toLocaleString('id-ID')}.`);
  const existing=await getPhase1SettlementState(id);if(existing?.status==='AR_OPEN'&&existing?.accurateInvoice?.number===invoice.number&&existing?.draftFingerprint===readiness.draftFingerprint)return {state:existing,idempotent:true};
  if(existing?.status==='AR_OPEN')throw new Error('Booking sudah memiliki Direct AR dari Sales Invoice berbeda. Rekonsiliasi manual wajib; status lama tidak ditimpa.');
  const entry=await getBookingWithMetadata(id),booking=entry?.data;if(!booking)throw new Error('Booking tidak ditemukan.');if(booking.partnerId)throw new Error('Direct AR tidak boleh dipakai untuk booking partner.');
  const stamp=now(),state={bookingId:id,mode:'DIRECT_AR',status:'AR_OPEN',draftId:readiness.draftId,draftFingerprint:readiness.draftFingerprint,amount:readiness.amount,accurateInvoice:invoice,localWalletMutation:false,createdAt:stamp,createdBy:clean(session?.username||session?.role,100),updatedAt:stamp};
  const created=await store().setJSON(settlementKey(id),state,{onlyIfNew:true});if(!created.modified){const latest=await getPhase1SettlementState(id);if(latest?.status==='AR_OPEN'&&latest?.accurateInvoice?.number===invoice.number)return {state:latest,idempotent:true};throw new Error('Settlement Direct AR sedang diproses atau sudah memiliki state berbeda.');}
  const next={...booking,billingStatus:'INVOICED_AR_OPEN',accurateStatus:'NATIVE_SI_POSTED',nativeSalesInvoice:{id:invoice.id,number:invoice.number,total:invoice.total,customerNo:invoice.customerNo,databaseName:invoice.databaseName,branchName:invoice.branchName,readBackVerified:true,postedAt:invoice.postedAt},settlement:{mode:'DIRECT_AR',status:'AR_OPEN',amount:readiness.amount,localWalletMutation:false},financeGate:{...(booking.financeGate||{}),status:'INVOICED_AR_OPEN',autoPost:false,reason:'NATIVE_SI_REVENUE_RECOGNIZED_AR_OPEN'},updatedAt:stamp};
  const saved=await saveBooking(next,{onlyIfMatch:entry.etag});if(!saved.modified){await store().setJSON(settlementKey(id),{...state,status:'ORPHANED_BOOKING_CONFLICT',orphanedAt:now()}).catch(()=>{});throw new Error('Booking berubah saat finalisasi Direct AR. Settlement ditandai ORPHANED dan wajib reconcile.');}
  try{await writeAdminAudit({session,request,action:'PHASE1_NATIVE_SI_DIRECT_AR_OPEN',entityType:'BOOKING',entityId:id,before:{billingStatus:booking.billingStatus,accurateStatus:booking.accurateStatus||null,settlement:booking.settlement||null},after:{billingStatus:next.billingStatus,accurateStatus:next.accurateStatus,settlement:next.settlement,nativeSalesInvoice:next.nativeSalesInvoice},note:'Native Sales Invoice read-back verified. Direct customer dicatat sebagai piutang terbuka; tidak ada mutasi wallet.',metadata:{draftId:readiness.draftId,draftFingerprint:readiness.draftFingerprint,accurateInvoiceNumber:invoice.number,accurateInvoiceId:invoice.id,total:invoice.total}});}catch{}
  return {state,booking:next,idempotent:false};
}

export async function assertPartnerDepositBridgeNotBypassed(bookingId){
  const readiness=await buildPhase1SettlementReadiness(bookingId);if(readiness.mode!=='PARTNER_DEPOSIT')return {ok:true,mode:readiness.mode};
  const e=new Error('Partner Deposit Native SI belum boleh dieksekusi: wallet Libra belum direpresentasikan sebagai Sales Down Payment Accurate yang dapat diaplikasikan ke invoice.');e.code='PARTNER_DEPOSIT_DP_BRIDGE_REQUIRED';e.httpStatus=409;e.readiness=readiness;throw e;
}
