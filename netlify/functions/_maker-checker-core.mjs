import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { activateProduction } from './_api-uat-core.mjs';
import { restoreBackup } from './_backup-core.mjs';
import { applyFinanceAdjustment } from './_billing-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { getApiPolicy, saveApiPolicy } from './_api-policy-core.mjs';
import { getPartner, getWallet, mutateWallet, normalizePartnerId } from './_partner-core.mjs';
import { deleteRateRule, getRatePlan, setRatePlanStatus, upsertRateRule } from './_rate-plan-core.mjs';
import { normalizeAdminRole } from './_admin-rbac-core.mjs';

const STORE='libra-approval-requests';
const store=()=>getStore(STORE);
const now=()=>new Date().toISOString();
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const requestId=()=>`APR-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const RULES={
 WALLET_ADJUST:{maker:['SUPERADMIN','FINANCE'],checker:['SUPERADMIN','FINANCE'],label:'Koreksi Saldo Partner'},
 FINANCE_ADJUSTMENT:{maker:['SUPERADMIN','FINANCE'],checker:['SUPERADMIN','FINANCE'],label:'Debit/Credit Note Partner'},
 CLAIM_SETTLEMENT:{maker:['SUPERADMIN','FINANCE'],checker:['SUPERADMIN','FINANCE'],label:'Penyelesaian Klaim Finansial'},
 RATE_RULE_UPSERT:{maker:['SUPERADMIN','FINANCE'],checker:['SUPERADMIN','FINANCE'],label:'Perubahan Rate Rule Aktif'},
 RATE_RULE_DELETE:{maker:['SUPERADMIN','FINANCE'],checker:['SUPERADMIN','FINANCE'],label:'Hapus Rate Rule'},
 RATE_PLAN_STATUS:{maker:['SUPERADMIN','FINANCE'],checker:['SUPERADMIN','FINANCE'],label:'Perubahan Status Rate Plan'},
 API_REACTIVATE:{maker:['SUPERADMIN','OPS'],checker:['SUPERADMIN','OPS'],label:'Aktifkan Kembali API Partner'},
 API_PRODUCTION_ACTIVATE:{maker:['SUPERADMIN','OPS'],checker:['SUPERADMIN'],label:'Go-Live Production API'},
 DR_RESTORE:{maker:['SUPERADMIN'],checker:['SUPERADMIN'],label:'Disaster Recovery Restore'},
};
const safeObject=value=>JSON.parse(JSON.stringify(value??{}));
function secret(){const s=String(process.env.ADMIN_SESSION_SECRET||'');if(s.length<32)throw new Error('ADMIN_SESSION_SECRET belum dikonfigurasi.');return s;}
function integrity(record){const base={requestId:record.requestId,actionType:record.actionType,entityId:record.entityId,payload:record.payload,makerUser:record.makerUser,makerRole:record.makerRole,createdAt:record.createdAt,expiresAt:record.expiresAt};return crypto.createHmac('sha256',secret()).update(JSON.stringify(base)).digest('base64url');}
function assertRule(actionType,role,side){const rule=RULES[actionType];if(!rule)throw new Error('Jenis approval tidak dikenal.');const normalized=normalizeAdminRole(role);if(!rule[side].includes(normalized))throw new Error(`Role ${normalized} tidak berwenang sebagai ${side} untuk ${rule.label}.`);return rule;}
export function makerCheckerRules(){return Object.entries(RULES).map(([actionType,r])=>({actionType,label:r.label,maker:[...r.maker],checker:[...r.checker]}));}

export async function createApprovalRequest({session,actionType,entityId,payload={},reason='',expiresHours=72}={}){
 const rule=assertRule(actionType,session?.role,'maker');const id=requestId();const createdAt=now();const record={requestId:id,actionType,actionLabel:rule.label,entityId:clean(entityId,160),payload:safeObject(payload),reason:clean(reason,800),makerUser:clean(session?.username,100),makerRole:normalizeAdminRole(session?.role),status:'PENDING',createdAt,expiresAt:new Date(Date.now()+Math.max(1,Math.min(Number(expiresHours)||72,168))*3600000).toISOString(),checkerUser:null,checkerRole:null,decisionAt:null,checkerNote:null,execution:null,updatedAt:createdAt};record.integrity=integrity(record);await store().setJSON(`request/${createdAt}-${id}`,record,{onlyIfNew:true});try{await createOperationalNotification({type:'APPROVAL_PENDING',severity:'WARNING',title:`Approval menunggu: ${rule.label}`,message:`${record.makerUser} mengajukan ${rule.label} untuk ${record.entityId||'-'}. Checker berbeda wajib memutuskan sebelum eksekusi.`,reference:id,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-approvals',dedupeKey:`approval-pending:${id}`,metadata:{requestId:id,actionType,entityId:record.entityId,makerUser:record.makerUser}});}catch{}return record;
}

export async function listApprovalRequests(limit=250){const {blobs}=await store().list({prefix:'request/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(Number(limit)||250,500)));const rows=[];for(const blob of selected){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;}
export async function getApprovalRequest(id){const rows=await listApprovalRequests(500);return rows.find(r=>r.requestId===String(id||''))||null;}
export async function countPendingApprovals(){return (await listApprovalRequests(500)).filter(r=>r.status==='PENDING'&&new Date(r.expiresAt).getTime()>Date.now()).length;}

async function beforeSnapshot(record){const p=record.payload||{};switch(record.actionType){case 'WALLET_ADJUST':case 'FINANCE_ADJUSTMENT':case 'CLAIM_SETTLEMENT':return getWallet(p.partnerId);case 'RATE_RULE_UPSERT':case 'RATE_RULE_DELETE':case 'RATE_PLAN_STATUS':return getRatePlan(p.partnerId);case 'API_REACTIVATE':return getApiPolicy(p.partnerId);case 'API_PRODUCTION_ACTIVATE':return null;case 'DR_RESTORE':return {backupId:p.backupId};default:return null;}}
async function execute(record,checker){const p=record.payload||{},actor=`${checker.username} (checker)`;switch(record.actionType){
 case 'WALLET_ADJUST':{const partnerId=normalizePartnerId(p.partnerId);if(!await getPartner(partnerId))throw new Error('Partner tidak ditemukan.');const delta=Math.trunc(Number(p.delta));if(!Number.isFinite(delta)||delta===0||Math.abs(delta)>10000000000)throw new Error('Nilai koreksi saldo tidak valid.');const result=await mutateWallet(partnerId,delta,`APPROVAL:${record.requestId}`,{source:'ADMIN_ADJUSTMENT',description:clean(p.description||record.reason,300),metadata:{approvalRequestId:record.requestId,maker:record.makerUser,checker:checker.username}});return {partnerId,balance:result.balance,transactionId:result.transactionId,delta};}
 case 'FINANCE_ADJUSTMENT':return applyFinanceAdjustment({partnerId:p.partnerId,signedAmount:p.signedAmount,kind:p.kind||(Number(p.signedAmount)>=0?'DEBIT_NOTE':'CREDIT_NOTE'),description:p.description||record.reason,externalReference:p.externalReference,bookingId:p.bookingId,claimReference:p.claimReference},{requestId:record.requestId,maker:record.makerUser,checker:checker.username});
 case 'CLAIM_SETTLEMENT':{
   if(!p.claimReference)throw new Error('Claim reference wajib untuk settlement.');const claimModule=await import('./_claim-core.mjs'),claim=await claimModule.getClaimCase(p.claimReference);if(!claim)throw new Error('Claim case tidak ditemukan untuk settlement.');
   if(claim.status!=='SETTLEMENT_PENDING'||claim.settlementApprovalRequestId!==record.requestId)throw new Error('Claim case tidak terkait dengan approval request ini atau belum SETTLEMENT_PENDING.');if(String(claim.partnerId||'')!==String(p.partnerId||'')||String(claim.bookingId||'')!==String(p.bookingId||''))throw new Error('Partner/booking pada approval tidak cocok dengan claim case.');
   const eligibility=claimModule.settlementEligibility(claim,{allowPending:true}),approvalAmount=Math.abs(Math.trunc(Number(p.amount)||0));if(!eligibility.eligible)throw new Error(`Claim tidak lagi memenuhi syarat settlement: ${eligibility.reasons.join(', ')}`);if(eligibility.settlementAmount!==approvalAmount)throw new Error('Nominal settlement claim berubah dari approval request. Buat approval baru.');
   const result=await applyFinanceAdjustment({partnerId:p.partnerId,signedAmount:-approvalAmount,kind:'CLAIM_SETTLEMENT',description:p.description||`Settlement klaim ${p.claimReference||''}`.trim(),externalReference:p.externalReference,bookingId:p.bookingId,claimReference:p.claimReference},{requestId:record.requestId,maker:record.makerUser,checker:checker.username});
   let claimSync={status:'SYNCED'};try{await claimModule.markClaimSettlementExecuted(p.claimReference,result,actor);}catch(error){claimSync={status:'PENDING_RECONCILIATION',error:clean(error?.message||error,500)};}return {...(result||{}),claimSync};
 }
 case 'RATE_RULE_UPSERT':return upsertRateRule(p.partnerId,{planName:p.planName,planStatus:p.planStatus,matchType:p.matchType,matchValue:p.matchValue,ratePerKg:p.ratePerKg,minimumChargeKg:p.minimumChargeKg,fixedFee:p.fixedFee,handlingFee:p.handlingFee,surchargePct:p.surchargePct,cutoffWit:p.cutoffWit,active:true},actor);
 case 'RATE_RULE_DELETE':return deleteRateRule(p.partnerId,p.ruleId,actor);
 case 'RATE_PLAN_STATUS':return setRatePlanStatus(p.partnerId,p.status,actor);
 case 'API_REACTIVATE':{const result=await saveApiPolicy(p.partnerId,{apiStatus:'ACTIVE'},actor);try{await createOperationalNotification({partnerId:result.partnerId,type:'API_SECURITY_STATUS',severity:'SUCCESS',title:'API partner diaktifkan kembali',message:`Akses API diaktifkan kembali setelah maker-checker ${record.requestId}.`,notifyPartner:true,notifyAdmin:true,partnerLink:'/partner/api-dashboard.html',adminLink:'/admin-api-security',dedupeKey:`api-reactivated:${record.requestId}`,metadata:{approvalRequestId:record.requestId}});}catch{}return result;}
 case 'API_PRODUCTION_ACTIVATE':return activateProduction(p.partnerId,actor);
 case 'DR_RESTORE':{const result=await restoreBackup(p.backupId,{actor,reason:`${record.reason} | maker-checker ${record.requestId}`});try{await createOperationalNotification({type:'RESTORE_COMPLETED',severity:'CRITICAL',title:'Disaster Recovery restore selesai',message:`Restore ${p.backupId} disetujui checker ${checker.username}. Safety backup ${result.safetyBackupId}.`,reference:p.backupId,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-audit-backup',dedupeKey:`restore-approved:${record.requestId}`,metadata:{approvalRequestId:record.requestId,safetyBackupId:result.safetyBackupId}});}catch{}return result;}
 default:throw new Error('Executor approval tidak tersedia.');}}

async function findKey(id){const {blobs}=await store().list({prefix:'request/'});const blob=blobs.find(b=>b.key.endsWith(`-${id}`));return blob?.key||null;}
export async function decideApproval(requestIdValue,session,{decision='APPROVE',note=''}={}){
 const id=clean(requestIdValue,100),key=await findKey(id);if(!key)throw new Error('Approval request tidak ditemukan.');const entry=await store().getWithMetadata(key,{type:'json',consistency:'strong'});const record=entry?.data;if(!record)throw new Error('Approval request tidak ditemukan.');if(record.status!=='PENDING')throw new Error(`Approval sudah berstatus ${record.status}.`);if(record.integrity!==integrity(record))throw new Error('Integritas approval request tidak valid.');if(new Date(record.expiresAt).getTime()<=Date.now())throw new Error('Approval request sudah kedaluwarsa.');assertRule(record.actionType,session?.role,'checker');if(String(record.makerUser).toLowerCase()===String(session?.username||'').toLowerCase())throw new Error('Maker tidak boleh menjadi checker untuk request yang sama.');
 const choice=String(decision||'').toUpperCase();if(!['APPROVE','REJECT'].includes(choice))throw new Error('Keputusan approval tidak valid.');const stamp=now();if(choice==='REJECT'){
   const rejected={...record,status:'REJECTED',checkerUser:clean(session.username,100),checkerRole:normalizeAdminRole(session.role),decisionAt:stamp,checkerNote:clean(note,800),updatedAt:stamp};const write=await store().setJSON(key,rejected,{onlyIfMatch:entry.etag});if(!write.modified)throw new Error('Approval sedang diproses admin lain.');if(record.actionType==='CLAIM_SETTLEMENT'&&record.payload?.claimReference){try{const claimModule=await import('./_claim-core.mjs');await claimModule.markClaimSettlementRejected(record.payload.claimReference,id,`${session.username} (checker)`,rejected.checkerNote);}catch{}}return {request:rejected,before:null,after:null};
 }
 const processing={...record,status:'PROCESSING',checkerUser:clean(session.username,100),checkerRole:normalizeAdminRole(session.role),decisionAt:stamp,checkerNote:clean(note,800),updatedAt:stamp};const lock=await store().setJSON(key,processing,{onlyIfMatch:entry.etag});if(!lock.modified)throw new Error('Approval sedang diproses admin lain.');const before=await beforeSnapshot(processing);try{const after=await execute(processing,session);const done={...processing,status:'EXECUTED',execution:{executedAt:now(),result:safeObject(after)},updatedAt:now()};await store().setJSON(key,done);try{await createOperationalNotification({type:'APPROVAL_EXECUTED',severity:'SUCCESS',title:`Approval selesai: ${record.actionLabel}`,message:`Request ${id} dibuat ${record.makerUser}, disetujui ${session.username}, dan sudah dieksekusi.`,reference:id,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-approvals',dedupeKey:`approval-executed:${id}`,metadata:{requestId:id,actionType:record.actionType,entityId:record.entityId}});}catch{}return {request:done,before,after};}catch(error){const failed={...processing,status:'FAILED',execution:{failedAt:now(),error:clean(error?.message||error,800)},updatedAt:now()};await store().setJSON(key,failed);throw error;}
}
