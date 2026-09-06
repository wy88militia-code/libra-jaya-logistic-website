import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { writeAdminAudit } from './_admin-audit-core.mjs';
import { getBooking } from './_booking-core.mjs';
import { getTopup } from './_partner-core.mjs';
import { getPartnerDepositDpUatState } from './_accurate-partner-deposit-dp-uat-core.mjs';
import { getPartnerDepositReceiptUatState } from './_accurate-partner-deposit-receipt-uat-core.mjs';
import { getPartnerDepositApplyUatState } from './_accurate-partner-deposit-apply-uat-core.mjs';

const STORE='libra-accurate-partner-deposit-uat-certification';
const store=()=>getStore(STORE);
const clean=(v,n=700)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const money=v=>Math.max(0,Math.trunc(Number(v)||0));
const now=()=>new Date().toISOString();
const sha=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const allowed=session=>['SUPERADMIN','FINANCE'].includes(upper(session?.role));
const isTestName=name=>/(test|tes|uat|sandbox)/i.test(String(name||''));
const productionDb=()=>clean(process.env.ACCURATE_PRODUCTION_DATABASE_NAME,160);
function key(bookingId,referenceId){return `proof/${encodeURIComponent(clean(bookingId,120))}/${encodeURIComponent(clean(referenceId,160))}`;}
function allChecksTrue(readback){const checks=readback?.checks;if(!checks||typeof checks!=='object')return false;const values=Object.values(checks);return values.length>0&&values.every(Boolean);}
function proofDigestPart(state){return state?{requestId:state.requestId||null,status:state.status||null,databaseName:state.databaseName||null,partnerId:state.partnerId||null,customerNo:state.customerNo||null,amount:state.amount??state.dpAmount??null,appliedAmount:state.appliedAmount??null,dpAccurateNumber:state.dpAccurateNumber||state.execution?.readback?.dpInvoiceNumber||null,execution:state.execution||null}:null;}

export async function getPartnerDepositUatCertification(bookingId,referenceId){return store().get(key(bookingId,referenceId),{type:'json',consistency:'strong'});}

export async function buildPartnerDepositUatCertificationReadiness({bookingId,referenceId}={}){
 const id=clean(bookingId,120),ref=clean(referenceId,160);if(!id||!ref)throw new Error('Booking ID dan reference top-up wajib.');
 const [booking,topup,dp,receipt,apply,existing]=await Promise.all([getBooking(id),getTopup(ref),getPartnerDepositDpUatState(ref),getPartnerDepositReceiptUatState(ref),getPartnerDepositApplyUatState(id,ref),getPartnerDepositUatCertification(id,ref)]);
 if(!booking)throw new Error('Booking tidak ditemukan.');const reasons=[],checks={};
 const partnerId=clean(booking.partnerId,80),topupPartner=clean(topup?.partnerId,80),dpPartner=clean(dp?.partnerId,80),receiptPartner=clean(receipt?.partnerId,80),applyPartner=clean(apply?.partnerId,80);
 checks.bookingPartner=Boolean(partnerId);checks.topupCompleted=upper(topup?.status)==='COMPLETED';checks.partnerChain=Boolean(partnerId)&&[topupPartner,dpPartner,receiptPartner,applyPartner].every(x=>x===partnerId);
 checks.dpExecuted=dp?.status==='EXECUTED'&&dp?.execution?.testOnly===true;checks.dpReadback=checks.dpExecuted&&allChecksTrue(dp?.execution?.readback);
 checks.receiptExecuted=receipt?.status==='EXECUTED'&&receipt?.execution?.testOnly===true;checks.receiptReadback=checks.receiptExecuted&&receipt?.execution?.readback?.verified===true;
 checks.applyExecuted=apply?.status==='EXECUTED'&&apply?.execution?.testOnly===true&&apply?.execution?.productionWrite===false;checks.applyReadback=checks.applyExecuted&&apply?.execution?.readback?.verified===true;
 const dbs=[dp?.databaseName,receipt?.databaseName,apply?.databaseName].map(x=>clean(x,160)).filter(Boolean),db=dbs[0]||null,prod=productionDb();checks.sameTestDatabase=dbs.length===3&&dbs.every(x=>x.toLowerCase()===db.toLowerCase())&&isTestName(db)&&(!prod||db.toLowerCase()!==prod.toLowerCase());
 const customerNos=[dp?.customerNo,receipt?.customerNo,apply?.customerNo].map(x=>clean(x,120)).filter(Boolean);checks.sameCustomer=customerNos.length===3&&customerNos.every(x=>x===customerNos[0]);
 const topupAmount=money(topup?.amount),dpAmount=money(dp?.amount),receiptAmount=money(receipt?.amount),invoiceAmount=money(apply?.invoiceAmount),appliedAmount=money(apply?.appliedAmount);checks.amountProvenance=topupAmount>0&&topupAmount===dpAmount&&dpAmount===receiptAmount;checks.applyAmount=appliedAmount>0&&appliedAmount===Math.min(dpAmount,invoiceAmount)&&money(apply?.execution?.readback?.dpAppliedAmount)===appliedAmount;
 const dpNumber=clean(dp?.execution?.accurateNumber,120),receiptDpNumber=clean(receipt?.dpAccurateNumber,120),applyDpNumber=clean(apply?.dpAccurateNumber,120),applyReadbackDp=clean(apply?.execution?.readback?.dpInvoiceNumber,120);checks.dpDocumentChain=Boolean(dpNumber)&&[receiptDpNumber,applyDpNumber,applyReadbackDp].every(x=>x===dpNumber);
 checks.noProductionWalletMutation=receipt?.execution?.noWalletMutation===true&&apply?.execution?.noWalletMutation===true&&apply?.execution?.productionWrite===false;
 for(const [code,ok] of Object.entries(checks))if(!ok)reasons.push({code:`UAT_${code.replace(/[A-Z]/g,m=>`_${m}`).toUpperCase()}`,message:`Proof ${code} belum tervalidasi.`});
 const proofSource={bookingId:id,referenceId:ref,topup:{partnerId:topupPartner,status:topup?.status||null,amount:topupAmount},dp:proofDigestPart(dp),receipt:proofDigestPart(receipt),apply:proofDigestPart(apply)},proofDigest=sha(proofSource),ready=Object.values(checks).every(Boolean);
 const existingValid=Boolean(existing?.status==='CERTIFIED'&&existing?.proofDigest===proofDigest);
 return {bookingId:id,referenceId:ref,partnerId:partnerId||null,customerNo:customerNos[0]||null,databaseName:db,topupAmount,invoiceAmount,appliedAmount,dpAccurateNumber:dpNumber||null,ready,status:ready?(existingValid?'UAT_CERTIFIED':'READY_TO_CERTIFY'):'BLOCKED',checks,reasons,proofDigest,proofSource,existing:existing||null,existingValid,productionGate:{allowed:false,status:'PRODUCTION_PARTNER_DEPOSIT_STILL_BLOCKED',reason:'UAT certification proves TEST behavior only. Production bridge, multi-top-up allocation, idempotent Accurate settlement, wallet debit, and anti-double revenue reconciliation remain separate required controls.'},guard:'READ_ONLY_UAT_PROOF_NO_ACCURATE_POST_NO_WALLET_MUTATION'};
}

export async function certifyPartnerDepositUat({bookingId,referenceId,session,request}={}){
 if(!allowed(session)){const e=new Error('Hanya FINANCE/SUPERADMIN yang dapat mensertifikasi UAT Partner Deposit.');e.httpStatus=403;throw e;}
 const r=await buildPartnerDepositUatCertificationReadiness({bookingId,referenceId});if(!r.ready)throw new Error(`UAT belum dapat disertifikasi: ${r.reasons.map(x=>x.code).join(', ')||'proof belum lengkap'}.`);if(r.existingValid)return {...r.existing,idempotent:true};
 const stamp=now(),row={certificationId:`P1DPCERT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,bookingId:r.bookingId,referenceId:r.referenceId,partnerId:r.partnerId,customerNo:r.customerNo,databaseName:r.databaseName,topupAmount:r.topupAmount,invoiceAmount:r.invoiceAmount,appliedAmount:r.appliedAmount,dpAccurateNumber:r.dpAccurateNumber,proofDigest:r.proofDigest,checks:r.checks,status:'CERTIFIED',certifiedAt:stamp,certifiedBy:clean(session?.username,100),certifiedByRole:upper(session?.role),productionAllowed:false,productionStatus:'PRODUCTION_PARTNER_DEPOSIT_STILL_BLOCKED',updatedAt:stamp};await store().setJSON(key(r.bookingId,r.referenceId),row);await writeAdminAudit({session,request,action:'PARTNER_DEPOSIT_UAT_CERTIFY',entityType:'BOOKING',entityId:r.bookingId,before:r.existing||null,after:row,note:'Tiga proof TEST Partner Deposit tersertifikasi: DP, receipt, dan apply-to-Native-SI. Sertifikasi tidak mengaktifkan production dan tidak memutasi wallet.'}).catch(()=>{});return {...row,idempotent:false};
}
