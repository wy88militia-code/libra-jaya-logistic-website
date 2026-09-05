import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { findRoute } from './_master-sheet-core.mjs';
import { resolvePartnerRate, calculateRateAmount } from './_rate-plan-core.mjs';
import { resolvePhase1PtdService } from './_phase1-ptd-core.mjs';

const STORE_NAME='libra-quotes';
const APPROVED_TTL_MS=30*60*1000;
const PENDING_TTL_MS=24*60*60*1000;
function store(){return getStore(STORE_NAME);}
function key(id){return `quote/${String(id||'').trim()}`;}
function now(){return new Date().toISOString();}
function number(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function phase1PolicyFrom(value={}){return resolvePhase1PtdService(value?.phase1ServiceCode||value?.phase1Service||'');}
function safeApprovalFloor(route,quote){
  const floor=Math.max(0,Math.round(Number(route?.tarifFloorKg)||0));if(!floor)return 0;
  const phase1=phase1PolicyFrom(quote),minimum=phase1?Number(phase1.customerMinimumChargeKg||0):Number(route?.minimumChargeableKg)||10;
  const chargeable=Math.max(Number(quote?.chargeableKg)||0,Number(quote?.weightKg)||0,minimum);
  return Math.round(floor*chargeable);
}

export async function createPartnerQuote(partnerId,input={}){
  const routeResult=await findRoute({kodeRute:input.kodeRute,kodeWilayah:input.kodeWilayah,kelurahan:input.kelurahan,distrik:input.distrik});
  if(!routeResult){const error=new Error('Rute tidak ditemukan pada Master yang sudah dipublish.');error.code='ROUTE_NOT_FOUND';throw error;}
  const route=routeResult.route;const weightKg=number(input.weightKg);
  if(!weightKg||weightKg<=0||weightKg>100000){const error=new Error('Berat kiriman tidak valid.');error.code='INVALID_WEIGHT';throw error;}
  if(['OUT_OF_COVERAGE','NOT_ACTIVE','PENDING_VERIFICATION'].includes(route.coverageStatus)){const error=new Error(route.coverageReason||'Rute belum dapat dibooking.');error.code=route.coverageStatus;error.route=route;throw error;}
  const phase1Policy=phase1PolicyFrom(input);
  const rateResolution=await resolvePartnerRate(partnerId,route);
  const effectiveRate=rateResolution.rate&&phase1Policy?{...rateResolution.rate,minimumChargeKg:phase1Policy.customerMinimumChargeKg}:rateResolution.rate;
  const pricing=route.coverageStatus==='ACTIVE'&&effectiveRate?calculateRateAmount(effectiveRate,weightKg):null;
  const quoteId=`LBRQ-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;const approved=Boolean(pricing?.totalAmount>0);const createdAt=now();
  const quote={quoteId,partnerId:String(partnerId),status:approved?'APPROVED':'PENDING_APPROVAL',amount:approved?pricing.totalAmount:null,currency:'IDR',weightKg,chargeableKg:pricing?.chargeableKg||null,kodeRute:route.kodeRute,kodeWilayah:route.kodeWilayah,kelurahan:route.kelurahan,distrik:route.distrik,kabupatenKota:route.kabupatenKota,coverageStatus:route.coverageStatus,coverageReason:route.coverageReason,skemaLayanan:route.skemaLayanan||route.jenisLayanan,minimumLoadKg:route.minimumLoadKg||null,sla:route.slaTotalHub||route.slaLastmile||route.slaMaster||null,cutoffWit:pricing?.cutoffWit||rateResolution.rate?.cutoffWit||rateResolution.cutoffWit||null,ratePlanId:rateResolution.planId||null,ratePlanName:rateResolution.planName||null,rateSource:rateResolution.source,phase1ServiceCode:phase1Policy?.code||null,phase1ServiceLabel:phase1Policy?.label||null,phase1ConsolidationDays:phase1Policy?.consolidationDays??null,phase1CustomerMinimumChargeKg:phase1Policy?.customerMinimumChargeKg??null,marginProtection:{floorRatePerKg:pricing?.marginFloorRatePerKg||Math.round(Number(route.tarifFloorKg)||0),targetRatePerKg:pricing?.targetRatePerKg||Math.round(Number(route.tarifRekomKg)||0),floorApplied:Boolean(pricing?.marginFloorApplied),originalRatePerKg:pricing?.originalRatePerKg??null,policy:'AUTO_ZONE_FLOOR'},pricingBreakdown:pricing?{ratePerKg:pricing.ratePerKg,originalRatePerKg:pricing.originalRatePerKg,minimumChargeKg:pricing.minimumChargeKg,actualWeightKg:pricing.actualWeightKg,chargeableKg:pricing.chargeableKg,baseAmount:pricing.baseAmount,surchargePct:pricing.surchargePct,surchargeAmount:pricing.surchargeAmount,fixedFee:pricing.fixedFee,handlingFee:pricing.handlingFee,totalAmount:pricing.totalAmount,marginFloorRatePerKg:pricing.marginFloorRatePerKg,targetRatePerKg:pricing.targetRatePerKg,marginFloorApplied:pricing.marginFloorApplied}:null,masterVersion:routeResult.version,createdAt,updatedAt:createdAt,expiresAt:new Date(Date.now()+(approved?APPROVED_TTL_MS:PENDING_TTL_MS)).toISOString(),approvalSource:approved?(String(rateResolution.source).startsWith('PARTNER_RATE_PLAN')?'RATE_PLAN':'AUTO_PRICING'):'ADMIN_REQUIRED'};
  await store().setJSON(key(quoteId),quote,{onlyIfNew:true});return quote;
}
export async function getQuote(quoteId){return store().get(key(quoteId),{type:'json',consistency:'strong'});}
export async function getQuoteWithMetadata(quoteId){return store().getWithMetadata(key(quoteId),{type:'json',consistency:'strong'});}
export async function listQuotes(limit=100){const {blobs}=await store().list({prefix:'quote/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(limit,300)));const rows=[];for(const blob of selected){const q=await store().get(blob.key,{type:'json'});if(q)rows.push(q);}return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
export async function approveQuote(quoteId,amount,adminNote=''){
  const entry=await getQuoteWithMetadata(quoteId);if(!entry?.data)throw new Error('Quote tidak ditemukan.');const value=Math.trunc(Number(amount));if(!Number.isFinite(value)||value<=0)throw new Error('Nominal quote harus lebih dari nol.');const quote=entry.data;if(!['PENDING_APPROVAL','APPROVED'].includes(quote.status))throw new Error(`Quote berstatus ${quote.status} dan tidak dapat diapprove.`);
  const routeResult=await findRoute({kodeRute:quote.kodeRute,kodeWilayah:quote.kodeWilayah,kelurahan:quote.kelurahan,distrik:quote.distrik});const route=routeResult?.route||null,minSafe=safeApprovalFloor(route,quote);if(minSafe>0&&value<minSafe){const e=new Error(`Nominal approval di bawah margin floor sehat. Minimum aman untuk quote ini Rp${minSafe.toLocaleString('id-ID')}.`);e.code='MARGIN_FLOOR';e.minimumSafeAmount=minSafe;e.floorRatePerKg=Math.round(Number(route?.tarifFloorKg)||0);throw e;}
  const next={...quote,status:'APPROVED',amount:value,adminNote:String(adminNote||'').trim().slice(0,500),approvalSource:'ADMIN',marginProtection:{...(quote.marginProtection||{}),minimumSafeAmount:minSafe||null,manualApprovalChecked:true},approvedAt:now(),updatedAt:now(),expiresAt:new Date(Date.now()+APPROVED_TTL_MS).toISOString()};const result=await store().setJSON(key(quoteId),next,{onlyIfMatch:entry.etag});if(!result.modified)throw new Error('Quote berubah di proses lain. Refresh lalu coba lagi.');return next;
}

export async function reserveQuote(partnerId,quoteId,bookingId){
  const entry=await getQuoteWithMetadata(quoteId);if(!entry?.data){const e=new Error('Quote tidak ditemukan.');e.code='QUOTE_NOT_FOUND';throw e;}const quote=entry.data;
  if(quote.partnerId!==partnerId){const e=new Error('Quote bukan milik partner ini.');e.code='QUOTE_FORBIDDEN';throw e;}
  if(quote.status==='BOOKED'&&quote.bookingId===bookingId)return {quote,idempotent:true,resume:false};
  if(quote.status==='PROCESSING'&&quote.bookingId===bookingId)return {quote,idempotent:false,resume:true};
  if(quote.status!=='APPROVED'){const e=new Error(`Quote belum dapat dipakai. Status: ${quote.status}.`);e.code='QUOTE_NOT_APPROVED';throw e;}
  if(new Date(quote.expiresAt).getTime()<=Date.now()){const e=new Error('Quote sudah kedaluwarsa. Minta quote baru.');e.code='QUOTE_EXPIRED';throw e;}
  if(!Number.isFinite(Number(quote.amount))||Number(quote.amount)<=0){const e=new Error('Quote tidak memiliki nominal sah.');e.code='QUOTE_INVALID';throw e;}
  const currentRoute=await findRoute({kodeRute:quote.kodeRute,kodeWilayah:quote.kodeWilayah,kelurahan:quote.kelurahan,distrik:quote.distrik});const minSafe=safeApprovalFloor(currentRoute?.route,quote);if(minSafe>0&&Number(quote.amount)<minSafe){const e=new Error('Quote berada di bawah margin floor terbaru. Minta quote baru.');e.code='MARGIN_FLOOR_CHANGED';throw e;}
  const processing={...quote,status:'PROCESSING',bookingId,processingAt:now(),updatedAt:now()};const result=await store().setJSON(key(quoteId),processing,{onlyIfMatch:entry.etag});if(!result.modified){const e=new Error('Quote sedang dipakai proses lain.');e.code='QUOTE_BUSY';throw e;}return {quote:processing,idempotent:false,resume:false};
}
export async function finalizeQuote(quoteId,bookingId,transactionId){const quote=await getQuote(quoteId);if(!quote)return;await store().setJSON(key(quoteId),{...quote,status:'BOOKED',bookingId,transactionId,bookedAt:quote.bookedAt||now(),updatedAt:now()});}
export async function releaseQuote(quoteId,reason=''){const quote=await getQuote(quoteId);if(!quote||quote.status!=='PROCESSING')return;await store().setJSON(key(quoteId),{...quote,status:'APPROVED',bookingId:null,processingAt:null,lastReleaseReason:String(reason||'').slice(0,300),updatedAt:now()});}
