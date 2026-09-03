import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking, updateBooking } from './_booking-core.mjs';

const STORE='libra-claims';
const store=()=>getStore(STORE);
const now=()=>new Date().toISOString();
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const money=v=>Math.trunc(Number(v)||0);
const sha256=v=>crypto.createHash('sha256').update(String(v)).digest('hex');

export const CLAIM_STATUSES=['OPEN','DOC_PENDING','UNDER_REVIEW','SUBMITTED_INSURER','APPROVED','REJECTED','SETTLEMENT_PENDING','SETTLED','CLOSED'];
export const INCIDENT_TYPES=['LOSS','DAMAGE','SHORTAGE','MISDELIVERY','DELAY','OTHER'];
export const INSURANCE_MODES=['INSURED','SELF_RISK','UNKNOWN'];
export const COVERAGE_DECISIONS=['NOT_EVALUATED','PENDING_POLICY_TERMS','ELIGIBLE','PARTIAL','INELIGIBLE','NOT_INSURED'];
export const DOCUMENT_KEYS=['INVOICE','AWB','CHRONOLOGY','DAMAGE_PHOTO','HANDOVER_PROOF','PACKING_LIST','POLICE_REPORT','INSURER_FORM'];

const TERMINAL=new Set(['REJECTED','CLOSED']);
const FINANCIAL_STATUSES=new Set(['SETTLEMENT_PENDING','SETTLED']);
const TRANSITIONS={
 OPEN:new Set(['DOC_PENDING','UNDER_REVIEW','REJECTED','CLOSED']),
 DOC_PENDING:new Set(['UNDER_REVIEW','REJECTED','CLOSED']),
 UNDER_REVIEW:new Set(['DOC_PENDING','SUBMITTED_INSURER','APPROVED','REJECTED','CLOSED']),
 SUBMITTED_INSURER:new Set(['UNDER_REVIEW','APPROVED','REJECTED']),
 APPROVED:new Set(['SETTLEMENT_PENDING','CLOSED']),
 SETTLEMENT_PENDING:new Set(['UNDER_REVIEW','SETTLED']),
 SETTLED:new Set(['CLOSED']),
 REJECTED:new Set(['CLOSED']),
 CLOSED:new Set(),
};

function claimKey(id){return `claim/${clean(id,120)}`;}
function eventPrefix(id){return `event/${clean(id,120)}/`;}
function headKey(id){return `head/${clean(id,120)}`;}
function activeBookingKey(id){return `active-booking/${clean(id,120)}`;}
function eventHash(row){const copy={...row};delete copy.eventHash;return sha256(JSON.stringify(copy));}
function normalizeDocs(input={},partial=false){const out={};for(const key of DOCUMENT_KEYS){if(partial&&!Object.prototype.hasOwnProperty.call(input,key))continue;out[key]=Boolean(input[key]===true||input[key]==='true'||input[key]==='on'||input[key]==='YES');}return out;}
function requiredDocuments(incidentType,insuranceMode){const required=['INVOICE','AWB','CHRONOLOGY'];if(incidentType==='DAMAGE')required.push('DAMAGE_PHOTO');if(['LOSS','SHORTAGE','MISDELIVERY'].includes(incidentType))required.push('HANDOVER_PROOF');if(insuranceMode==='INSURED')required.push('INSURER_FORM');return [...new Set(required)];}
function documentsComplete(claim){const required=claim.requiredDocuments||requiredDocuments(claim.incidentType,claim.insuranceMode);return required.every(k=>Boolean(claim.documents?.[k]));}
function initialCoverage(mode){if(mode==='INSURED')return 'PENDING_POLICY_TERMS';if(mode==='SELF_RISK')return 'NOT_INSURED';return 'NOT_EVALUATED';}

async function appendEvent(claimId,type,actor,details={}){
 const previous=await store().get(headKey(claimId),{type:'json',consistency:'strong'});const createdAt=now();const eventId=`CLMEVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;const row={eventId,claimId,type:clean(type,80),actor:clean(actor,100),details:JSON.parse(JSON.stringify(details||{})),previousEventHash:previous?.eventHash||null,createdAt};row.eventHash=eventHash(row);await store().setJSON(`${eventPrefix(claimId)}${createdAt}-${eventId}`,row,{onlyIfNew:true});await store().setJSON(headKey(claimId),{eventId,eventHash:row.eventHash,createdAt});return row;
}

export async function getClaimCase(id){return store().get(claimKey(id),{type:'json',consistency:'strong'});}
export async function getClaimCaseWithMetadata(id){return store().getWithMetadata(claimKey(id),{type:'json',consistency:'strong'});}
export async function listClaimCases(limit=300){const {blobs}=await store().list({prefix:'claim/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(Number(limit)||300,1000)));const rows=[];for(const blob of selected){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows.sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));}

export async function createClaimCase(input={},actor='admin'){
 const bookingId=clean(input.bookingId,120);const booking=await getBooking(bookingId);if(!booking)throw new Error('Booking tidak ditemukan.');const activeKey=activeBookingKey(bookingId);
 const existingId=await store().get(activeKey,{type:'text',consistency:'strong'});if(existingId){const existing=await getClaimCase(existingId);if(existing&&!TERMINAL.has(existing.status))throw new Error(`Booking sudah memiliki klaim aktif ${existing.claimId}.`);await store().delete(activeKey);}
 const incidentType=clean(input.incidentType,40).toUpperCase();if(!INCIDENT_TYPES.includes(incidentType))throw new Error('Jenis insiden tidak valid.');
 const insuranceMode=clean(input.insuranceMode||'UNKNOWN',30).toUpperCase();if(!INSURANCE_MODES.includes(insuranceMode))throw new Error('Mode asuransi tidak valid.');
 const requestedAmount=money(input.requestedAmount);if(requestedAmount<0||requestedAmount>10000000000)throw new Error('Nilai klaim tidak valid.');const invoiceValue=money(input.invoiceValue),declaredValue=money(input.declaredValue);if(invoiceValue<0||declaredValue<0)throw new Error('Nilai barang tidak valid.');
 const claimId=`CLM-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,createdAt=now(),documents=normalizeDocs(input.documents||{}),coverageDecision=initialCoverage(insuranceMode);
 const claim={claimId,bookingId,partnerId:booking.partnerId||null,incidentType,status:'OPEN',incidentAt:clean(input.incidentAt,40)||null,description:clean(input.description,1500)||null,sourceIncidentEventId:clean(input.sourceIncidentEventId,120)||null,requestedAmount,invoiceValue,declaredValue,currency:'IDR',insuranceMode,insurerName:clean(input.insurerName,160)||null,policyReference:clean(input.policyReference,160)||null,insurerClaimReference:null,coverageDecision,coverageNote:insuranceMode==='INSURED'?'Menunggu wording polis/konfirmasi insurer. Mesin tidak memutus coverage otomatis.':null,approvedAmount:0,deductibleAmount:0,settlementAmount:0,settlementApprovalRequestId:null,settlementAdjustmentId:null,settlementTransactionId:null,documents,requiredDocuments:requiredDocuments(incidentType,insuranceMode),documentsComplete:false,createdAt,createdBy:clean(actor,100),updatedAt:createdAt,updatedBy:clean(actor,100)};claim.documentsComplete=documentsComplete(claim);
 const reserved=await store().set(activeKey,claimId,{onlyIfNew:true});if(!reserved.modified){const lockedId=await store().get(activeKey,{type:'text',consistency:'strong'});throw new Error(`Booking sedang dikunci proses klaim lain${lockedId?` (${lockedId})`:''}. Refresh lalu coba lagi.`);}
 try{const write=await store().setJSON(claimKey(claimId),claim,{onlyIfNew:true});if(!write.modified)throw new Error('Claim ID sudah digunakan.');}catch(error){const lockedId=await store().get(activeKey,{type:'text',consistency:'strong'});if(lockedId===claimId)await store().delete(activeKey);throw error;}
 await appendEvent(claimId,'CLAIM_OPENED',actor,{bookingId,incidentType,insuranceMode,requestedAmount});await updateBooking(bookingId,{hasIncident:true,claimId,claimReference:claimId,claimStatus:'OPEN',claimIncidentType:incidentType,claimUpdatedAt:createdAt});return claim;
}

export async function updateClaimCase(claimIdValue,patch={},actor='admin'){
 const claimId=clean(claimIdValue,120),entry=await getClaimCaseWithMetadata(claimId);if(!entry?.data)throw new Error('Klaim tidak ditemukan.');const current=entry.data;if(current.status==='CLOSED')throw new Error('Klaim sudah CLOSED dan dikunci.');const next={...current};
 if(patch.status){const status=clean(patch.status,40).toUpperCase();if(!CLAIM_STATUSES.includes(status))throw new Error('Status klaim tidak valid.');if(status!==current.status&&FINANCIAL_STATUSES.has(status))throw new Error(`Status ${status} hanya boleh diubah oleh workflow settlement maker-checker.`);if(status!==current.status&&!TRANSITIONS[current.status]?.has(status))throw new Error(`Transisi ${current.status} → ${status} tidak diizinkan.`);next.status=status;}
 if(patch.description!==undefined)next.description=clean(patch.description,1500)||null;if(patch.documents)next.documents={...current.documents,...normalizeDocs(patch.documents,true)};if(patch.insurerName!==undefined)next.insurerName=clean(patch.insurerName,160)||null;if(patch.policyReference!==undefined)next.policyReference=clean(patch.policyReference,160)||null;if(patch.insurerClaimReference!==undefined)next.insurerClaimReference=clean(patch.insurerClaimReference,160)||null;
 if(patch.coverageDecision){const decision=clean(patch.coverageDecision,40).toUpperCase();if(!COVERAGE_DECISIONS.includes(decision))throw new Error('Keputusan coverage tidak valid.');next.coverageDecision=decision;}if(patch.coverageNote!==undefined)next.coverageNote=clean(patch.coverageNote,1000)||null;
 if(patch.approvedAmount!==undefined){const n=money(patch.approvedAmount);if(n<0||n>10000000000)throw new Error('Approved amount tidak valid.');next.approvedAmount=n;}if(patch.deductibleAmount!==undefined){const n=money(patch.deductibleAmount);if(n<0||n>10000000000)throw new Error('Deductible tidak valid.');next.deductibleAmount=n;}
 next.documentsComplete=documentsComplete(next);next.settlementAmount=Math.max(0,money(next.approvedAmount)-money(next.deductibleAmount));next.updatedAt=now();next.updatedBy=clean(actor,100);if(next.status==='APPROVED'&&next.approvedAmount<=0)throw new Error('Status APPROVED wajib approved amount > 0.');if(next.insuranceMode==='INSURED'&&['ELIGIBLE','PARTIAL'].includes(next.coverageDecision)&&!next.policyReference)throw new Error('Policy reference wajib sebelum coverage insured dinyatakan eligible.');
 const write=await store().setJSON(claimKey(claimId),next,{onlyIfMatch:entry.etag});if(!write.modified)throw new Error('Klaim berubah di proses lain. Refresh lalu coba lagi.');await appendEvent(claimId,'CLAIM_UPDATED',actor,{fromStatus:current.status,toStatus:next.status,coverageDecision:next.coverageDecision,documentsComplete:next.documentsComplete,approvedAmount:next.approvedAmount,deductibleAmount:next.deductibleAmount});if(TERMINAL.has(next.status))await store().delete(activeBookingKey(next.bookingId));await updateBooking(next.bookingId,{claimStatus:next.status,claimReference:claimId,claimCoverageDecision:next.coverageDecision,claimUpdatedAt:next.updatedAt});return next;
}

export function settlementEligibility(claim){const reasons=[];if(!claim)reasons.push('CLAIM_NOT_FOUND');else{if(claim.status!=='APPROVED')reasons.push('STATUS_NOT_APPROVED');if(!claim.documentsComplete)reasons.push('DOCUMENTS_INCOMPLETE');if(claim.insuranceMode==='UNKNOWN')reasons.push('INSURANCE_MODE_UNKNOWN');if(claim.insuranceMode==='INSURED'&&!['ELIGIBLE','PARTIAL'].includes(claim.coverageDecision))reasons.push('COVERAGE_NOT_APPROVED');if(claim.insuranceMode==='INSURED'&&!claim.policyReference)reasons.push('POLICY_REFERENCE_REQUIRED');if(money(claim.approvedAmount)<=0)reasons.push('APPROVED_AMOUNT_REQUIRED');if(money(claim.deductibleAmount)>money(claim.approvedAmount))reasons.push('DEDUCTIBLE_EXCEEDS_APPROVED');if(Math.max(0,money(claim.approvedAmount)-money(claim.deductibleAmount))<=0)reasons.push('SETTLEMENT_ZERO');}return {eligible:reasons.length===0,reasons,settlementAmount:claim?Math.max(0,money(claim.approvedAmount)-money(claim.deductibleAmount)):0};}

export async function markClaimSettlementRequested(claimIdValue,approvalRequestId,actor='finance'){
 const claimId=clean(claimIdValue,120),entry=await getClaimCaseWithMetadata(claimId);if(!entry?.data)throw new Error('Klaim tidak ditemukan.');const current=entry.data,check=settlementEligibility(current);if(!check.eligible)throw new Error(`Klaim belum siap settlement: ${check.reasons.join(', ')}`);const approvalId=clean(approvalRequestId,120);if(!approvalId)throw new Error('Approval request ID wajib.');const stamp=now(),next={...current,status:'SETTLEMENT_PENDING',settlementApprovalRequestId:approvalId,settlementAmount:check.settlementAmount,updatedAt:stamp,updatedBy:clean(actor,100)};const write=await store().setJSON(claimKey(claimId),next,{onlyIfMatch:entry.etag});if(!write.modified)throw new Error('Klaim berubah saat mengaitkan approval settlement.');await appendEvent(claimId,'SETTLEMENT_REQUESTED',actor,{approvalRequestId:approvalId,settlementAmount:next.settlementAmount});await updateBooking(next.bookingId,{claimStatus:next.status,claimSettlementApprovalRequestId:approvalId,claimUpdatedAt:stamp});return next;
}

export async function markClaimSettlementExecuted(claimIdValue,result={},actor='checker'){
 const claimId=clean(claimIdValue,120),entry=await getClaimCaseWithMetadata(claimId);if(!entry?.data)return null;const current=entry.data;if(current.status==='SETTLED')return current;if(current.status!=='SETTLEMENT_PENDING')throw new Error(`Klaim ${claimId} bukan SETTLEMENT_PENDING.`);const next={...current,status:'SETTLED',settlementAdjustmentId:clean(result.adjustmentId,120)||null,settlementTransactionId:clean(result.transactionId,160)||null,settledAt:now(),updatedAt:now(),updatedBy:clean(actor,100)};const write=await store().setJSON(claimKey(claimId),next,{onlyIfMatch:entry.etag});if(!write.modified)throw new Error('Klaim berubah saat settlement.');await appendEvent(claimId,'SETTLEMENT_EXECUTED',actor,{approvalRequestId:current.settlementApprovalRequestId,adjustmentId:next.settlementAdjustmentId,transactionId:next.settlementTransactionId,settlementAmount:next.settlementAmount});await updateBooking(next.bookingId,{claimStatus:'SETTLED',claimSettlementTransactionId:next.settlementTransactionId,claimUpdatedAt:next.updatedAt});return next;
}

export async function markClaimSettlementRejected(claimIdValue,approvalRequestId,actor='checker',note=''){
 const claimId=clean(claimIdValue,120),entry=await getClaimCaseWithMetadata(claimId);if(!entry?.data)return null;const current=entry.data;if(current.status!=='SETTLEMENT_PENDING')return current;const expected=clean(current.settlementApprovalRequestId,120),given=clean(approvalRequestId,120);if(expected&&given&&expected!==given)throw new Error('Approval request tidak cocok dengan klaim.');const next={...current,status:'UNDER_REVIEW',settlementApprovalRequestId:null,settlementRejectionNote:clean(note,800)||null,updatedAt:now(),updatedBy:clean(actor,100)};const write=await store().setJSON(claimKey(claimId),next,{onlyIfMatch:entry.etag});if(!write.modified)throw new Error('Klaim berubah saat reject settlement.');await appendEvent(claimId,'SETTLEMENT_REJECTED',actor,{approvalRequestId:given,note:next.settlementRejectionNote});await updateBooking(next.bookingId,{claimStatus:next.status,claimSettlementApprovalRequestId:null,claimUpdatedAt:next.updatedAt});return next;
}

export async function listClaimEvents(claimId,limit=200){const {blobs}=await store().list({prefix:eventPrefix(claimId)});const selected=blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-Math.max(1,Math.min(Number(limit)||200,500)));const rows=[];for(const blob of selected){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;}
export async function verifyClaimChain(claimId){const rows=await listClaimEvents(claimId,500);let previous=null;for(const row of rows){if((row.previousEventHash||null)!==previous)return {ok:false,eventId:row.eventId,reason:'PREVIOUS_HASH_MISMATCH'};if(eventHash(row)!==row.eventHash)return {ok:false,eventId:row.eventId,reason:'EVENT_HASH_MISMATCH'};previous=row.eventHash;}return {ok:true,count:rows.length,headHash:previous};}
export async function claimSummary(){const rows=await listClaimCases(1000),summary={total:rows.length,open:0,approved:0,settlementPending:0,settled:0,rejected:0,requestedAmount:0,approvedAmount:0,settlementAmount:0};for(const c of rows){if(!['CLOSED','REJECTED','SETTLED'].includes(c.status))summary.open++;if(c.status==='APPROVED')summary.approved++;if(c.status==='SETTLEMENT_PENDING')summary.settlementPending++;if(c.status==='SETTLED')summary.settled++;if(c.status==='REJECTED')summary.rejected++;summary.requestedAmount+=money(c.requestedAmount);summary.approvedAmount+=money(c.approvedAmount);if(c.status==='SETTLED')summary.settlementAmount+=money(c.settlementAmount);}return summary;}
