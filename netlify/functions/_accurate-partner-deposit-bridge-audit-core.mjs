import crypto from 'node:crypto';
import { accurateGet } from './_accurate-core.mjs';
import { getBooking } from './_booking-core.mjs';
import { buildPhase1NativeSiReadiness } from './_accurate-native-si-core.mjs';
import { getPhase1InvoiceDraft } from './_phase1-invoice-draft-core.mjs';
import { getWallet } from './_partner-core.mjs';

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const money=v=>Number.isFinite(Number(v))?Math.round(Number(v)):null;
const now=()=>new Date().toISOString();
const sha=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
function responseRows(data){return Array.isArray(data?.d)?data.d:Array.isArray(data?.d?.data)?data.d.data:[];}
function safeValue(v){if(v===null||v===undefined)return null;if(typeof v==='string'||typeof v==='number'||typeof v==='boolean')return v;return null;}
function dpSignals(value,path='',depth=0,out=[]){if(depth>5||value===null||value===undefined)return out;if(Array.isArray(value)){value.slice(0,50).forEach((v,i)=>dpSignals(v,`${path}[${i}]`,depth+1,out));return out;}if(typeof value!=='object')return out;for(const [key,val] of Object.entries(value)){const next=path?`${path}.${key}`:key,lower=key.toLowerCase();if(/downpayment|down_payment|invoice.?dp|input.?down.?payment|available.?dp|available.*payment|remaining.*payment|dp.?amount/.test(lower)){const primitive=safeValue(val);if(primitive!==null)out.push({path:next,value:primitive});}if(val&&typeof val==='object')dpSignals(val,next,depth+1,out);}return out.slice(0,120);}
async function listDpCandidates(customerNo){
  const base={'sp.pageSize':100,'sp.page':1,fields:'id,number','filter.customerNo':customerNo,'filter.invoiceDp':true,availableDpAboveZeroFilter:true};
  try{const {data}=await accurateGet('sales-invoice','list',base);return {rows:responseRows(data),queryMode:'CUSTOMER_INVOICE_DP_AVAILABLE_GT_ZERO',fallback:false,error:null};}
  catch(first){
    try{const {data}=await accurateGet('sales-invoice','list',{'sp.pageSize':100,'sp.page':1,fields:'id,number','filter.customerNo':customerNo,'filter.invoiceDp':true});return {rows:responseRows(data),queryMode:'CUSTOMER_INVOICE_DP',fallback:true,error:clean(first?.message||first,500)};}
    catch(second){return {rows:[],queryMode:'FAILED',fallback:true,error:clean(`${first?.message||first}; ${second?.message||second}`,900)};}
  }
}
async function readCandidateDetail(row){const id=row?.id??null,number=clean(row?.number||row?.no,120);if(id===null||id===undefined)return {id:null,number,error:'ID Sales Down Payment candidate tidak tersedia.',signals:[],rawDigest:null};try{const {data}=await accurateGet('sales-invoice','detail',{id}),detail=data?.d||data?.r||data||{},signals=dpSignals(detail);return {id,number:clean(detail?.number||detail?.no||number,120),customerNo:clean(detail?.customerNo||detail?.customer?.no,120)||null,invoiceDp:detail?.invoiceDp===true||String(detail?.invoiceDp||'').toLowerCase()==='true',inputDownPayment:money(detail?.inputDownPayment),signals,rawDigest:sha(detail),error:null};}catch(error){return {id,number,error:clean(error?.message||error,700),signals:[],rawDigest:null};}}

export async function buildPartnerDepositBridgeAudit(bookingId){
  const id=clean(bookingId,120);if(!id)throw new Error('Booking ID wajib.');
  const [booking,draft,native]=await Promise.all([getBooking(id),getPhase1InvoiceDraft(id),buildPhase1NativeSiReadiness(id)]);if(!booking)throw new Error('Booking tidak ditemukan.');if(!booking.partnerId)throw new Error('Audit Partner Deposit hanya untuk booking dengan partnerId.');if(!draft)throw new Error('Draft invoice Tahap 1 belum tersedia.');
  const wallet=await getWallet(booking.partnerId),customerNo=clean(native?.customerResolution?.matched?.no||native?.payloadPreview?.customerNo,120),reasons=[];
  if(!customerNo)reasons.push({code:'ACCURATE_CUSTOMER_MAPPING_REQUIRED',message:'Customer Accurate partner belum ter-mapping exact.'});
  let listed={rows:[],queryMode:'NOT_RUN',fallback:false,error:null},candidates=[];
  if(customerNo){listed=await listDpCandidates(customerNo);if(listed.error&&listed.queryMode==='FAILED')reasons.push({code:'ACCURATE_DOWNPAYMENT_QUERY_FAILED',message:listed.error});for(const row of listed.rows.slice(0,50))candidates.push(await readCandidateDetail(row));}
  const detailErrors=candidates.filter(x=>x.error).length;if(detailErrors)reasons.push({code:'DOWNPAYMENT_DETAIL_INCOMPLETE',message:`${detailErrors} kandidat Sales Down Payment tidak dapat dibaca detailnya.`});
  const originalInputTotal=candidates.reduce((s,x)=>s+(Number.isFinite(x.inputDownPayment)?x.inputDownPayment:0),0),availableAmountReadable=false,availableAmount=null;
  reasons.push({code:'AVAILABLE_DP_AMOUNT_NOT_CERTIFIED',message:'Daftar kandidat dapat dibaca, tetapi bridge tidak menganggap inputDownPayment/original DP sebagai saldo tersedia. Remaining available amount harus dibuktikan eksplisit sebelum settlement partner diaktifkan.'});
  reasons.push({code:'DEPOSIT_MIGRATION_PROVENANCE_REQUIRED',message:'Wallet Libra dan Sales Down Payment Accurate harus punya provenance/mapping top-up yang dapat direkonsiliasi; kesamaan nominal saja tidak cukup.'});
  const walletBalance=Math.max(0,Math.trunc(Number(wallet?.balance)||0)),invoiceAmount=Math.max(0,Math.trunc(Number(draft.total)||0));
  return {
    bookingId:id,partnerId:booking.partnerId,customerNo:customerNo||null,bridgeReady:false,status:'BLOCKED_READ_ONLY_AUDIT',reasons,
    localWallet:{balance:walletBalance,sufficientForInvoice:walletBalance>=invoiceAmount,updatedAt:wallet?.updatedAt||null},invoice:{draftId:draft.draftId,draftFingerprint:draft.fingerprint,amount:invoiceAmount},
    accurateDownPayment:{queryMode:listed.queryMode,queryFallback:Boolean(listed.fallback),queryWarning:listed.error||null,candidateCount:candidates.length,candidates,originalInputDownPaymentTotal:originalInputTotal,availableAmountReadable,availableAmount,doNotEquateOriginalInputWithAvailable:true},
    reconciliation:{walletBalance,invoiceAmount,availableDpAmount:availableAmount,nominalComparable:false,provenanceVerified:false,automaticMigrationAllowed:false,salesReceiptFallbackForbidden:true},
    guard:'READ_ONLY_NO_ACCURATE_WRITE_NO_WALLET_MUTATION',checkedAt:now(),
  };
}
