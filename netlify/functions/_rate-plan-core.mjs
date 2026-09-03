import { getStore } from '@netlify/blobs';
import { getPartner, normalizePartnerId } from './_partner-core.mjs';

const STORE_NAME='libra-rate-plans';
const DEFAULT_CUTOFF_WIT='14:00';
const store=()=>getStore(STORE_NAME);
const now=()=>new Date().toISOString();
const num=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
const text=(value,max=120)=>String(value??'').trim().slice(0,max);
const upper=value=>text(value).toUpperCase();

function normalizeCutoff(value){
  const raw=text(value||process.env.LIBRA_CUTOFF_WIT||DEFAULT_CUTOFF_WIT,5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw)?raw:DEFAULT_CUTOFF_WIT;
}
function normalizeRule(input={}){
  const matchType=['DEFAULT','ROUTE','ZONE'].includes(upper(input.matchType))?upper(input.matchType):'DEFAULT';
  const matchValue=matchType==='DEFAULT'?'DEFAULT':upper(input.matchValue);
  if(matchType!=='DEFAULT'&&!matchValue)throw new Error('Kode route/zona wajib diisi.');
  const ratePerKg=Math.round(num(input.ratePerKg));
  if(ratePerKg<=0||ratePerKg>100000000)throw new Error('Rate per kg tidak valid.');
  const minimumChargeKg=Math.max(0,num(input.minimumChargeKg));
  const fixedFee=Math.max(0,Math.round(num(input.fixedFee)));
  const handlingFee=Math.max(0,Math.round(num(input.handlingFee)));
  const surchargePct=Math.max(0,Math.min(100,num(input.surchargePct)));
  const ruleId=matchType==='DEFAULT'?'DEFAULT':`${matchType}:${matchValue}`;
  return {ruleId,matchType,matchValue,ratePerKg,minimumChargeKg,fixedFee,handlingFee,surchargePct,cutoffWit:normalizeCutoff(input.cutoffWit),active:input.active!==false};
}
function legacyTable(){try{const parsed=JSON.parse(process.env.LIBRA_RATE_TABLE_JSON||'{}');return parsed&&typeof parsed==='object'?parsed:{};}catch{return {};}}
function legacyRate(route){
  const table=legacyTable();const raw=table[route.kodeRute]||table[route.zonaTarif]||table.DEFAULT||null;if(!raw)return null;
  const ratePerKg=num(raw.ratePerKg);if(ratePerKg<=0)return null;
  return {ruleId:'LEGACY',matchType:'LEGACY',matchValue:route.kodeRute||route.zonaTarif||'DEFAULT',ratePerKg,minimumChargeKg:Math.max(0,num(raw.minimumChargeKg)),fixedFee:Math.max(0,num(raw.fixedFee)),handlingFee:Math.max(0,num(raw.handlingFee)),surchargePct:Math.max(0,num(raw.surchargePct)),cutoffWit:normalizeCutoff(raw.cutoffWit),active:true};
}

export async function getRatePlan(partnerId){const id=normalizePartnerId(partnerId);if(!id)return null;return store().get(`partner/${id}`,{type:'json',consistency:'strong'});}
export async function listRatePlans(){const {blobs}=await store().list({prefix:'partner/'});const rows=[];for(const blob of blobs){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows.sort((a,b)=>String(a.partnerId).localeCompare(String(b.partnerId)));}
export async function ensureApiPartnerRatePlan(partnerId,companyName='',adminUser='system'){
  const id=normalizePartnerId(partnerId);if(!id)throw new Error('Partner ID tidak valid.');const existing=await getRatePlan(id);if(existing)return existing;const stamp=now();const plan={partnerId:id,planName:text(`API ${companyName||id}`),status:'INACTIVE',currency:'IDR',rules:[],createdAt:stamp,updatedAt:stamp,updatedBy:text(adminUser,80),note:'Placeholder onboarding API. Aktifkan setelah harga jual partner dikonfigurasi.'};await store().setJSON(`partner/${id}`,plan,{onlyIfNew:true});return plan;
}
export async function upsertRateRule(partnerId,input={},adminUser='admin'){
  const id=normalizePartnerId(partnerId);if(!id)throw new Error('Partner ID tidak valid.');if(!await getPartner(id))throw new Error('Partner belum terdaftar.');const current=await getRatePlan(id);const rule=normalizeRule(input);const rules=[...(current?.rules||[])].filter(row=>row.ruleId!==rule.ruleId);rules.push(rule);rules.sort((a,b)=>a.matchType.localeCompare(b.matchType)||a.matchValue.localeCompare(b.matchValue));
  const stamp=now();const plan={partnerId:id,planName:text(input.planName||current?.planName||`Rate Plan ${id}`),status:upper(input.planStatus||current?.status||'ACTIVE')==='INACTIVE'?'INACTIVE':'ACTIVE',currency:'IDR',rules,createdAt:current?.createdAt||stamp,updatedAt:stamp,updatedBy:text(adminUser,80)};await store().setJSON(`partner/${id}`,plan);return plan;
}
export async function deleteRateRule(partnerId,ruleId,adminUser='admin'){
  const id=normalizePartnerId(partnerId);const current=await getRatePlan(id);if(!current)throw new Error('Rate plan partner tidak ditemukan.');const target=text(ruleId,160);const rules=(current.rules||[]).filter(row=>row.ruleId!==target);if(rules.length===(current.rules||[]).length)throw new Error('Rule tidak ditemukan.');const plan={...current,rules,updatedAt:now(),updatedBy:text(adminUser,80)};await store().setJSON(`partner/${id}`,plan);return plan;
}
export async function setRatePlanStatus(partnerId,status,adminUser='admin'){
  const id=normalizePartnerId(partnerId);const current=await getRatePlan(id);if(!current)throw new Error('Rate plan partner tidak ditemukan.');const plan={...current,status:upper(status)==='INACTIVE'?'INACTIVE':'ACTIVE',updatedAt:now(),updatedBy:text(adminUser,80)};await store().setJSON(`partner/${id}`,plan);return plan;
}

export async function resolvePartnerRate(partnerId,route={}){
  const plan=await getRatePlan(partnerId);
  if(plan){
    if(plan.status!=='ACTIVE')return {rate:null,source:'RATE_PLAN_INACTIVE',planId:plan.partnerId,planName:plan.planName,planStatus:plan.status,cutoffWit:normalizeCutoff()};
    const rules=(plan.rules||[]).filter(row=>row.active!==false);const routeCode=upper(route.kodeRute);const zone=upper(route.zonaTarif);
    const rule=rules.find(row=>row.matchType==='ROUTE'&&row.matchValue===routeCode)||rules.find(row=>row.matchType==='ZONE'&&row.matchValue===zone)||rules.find(row=>row.matchType==='DEFAULT');
    if(rule)return {rate:rule,source:'PARTNER_RATE_PLAN',planId:plan.partnerId,planName:plan.planName,planStatus:plan.status};
    return {rate:null,source:'PARTNER_RATE_PLAN_NO_MATCH',planId:plan.partnerId,planName:plan.planName,planStatus:plan.status,cutoffWit:normalizeCutoff()};
  }
  const partner=await getPartner(partnerId);if(partner?.onboardingApplicationId)return {rate:null,source:'API_PARTNER_RATE_PLAN_REQUIRED',planId:null,planName:null,planStatus:null,cutoffWit:normalizeCutoff()};
  const legacy=legacyRate(route);if(legacy)return {rate:legacy,source:'LEGACY_RATE_TABLE',planId:null,planName:'Legacy Rate Table',planStatus:'ACTIVE'};
  return {rate:null,source:'NO_RATE_PLAN',planId:null,planName:null,planStatus:null,cutoffWit:normalizeCutoff()};
}

export function calculateRateAmount(rate,weightKg){
  if(!rate)return null;const weight=num(weightKg);if(weight<=0)return null;const chargeableKg=Math.max(weight,num(rate.minimumChargeKg));const baseAmount=Math.round(chargeableKg*num(rate.ratePerKg));const surchargeAmount=Math.round(baseAmount*num(rate.surchargePct)/100);const fixedFee=Math.round(num(rate.fixedFee));const handlingFee=Math.round(num(rate.handlingFee));const totalAmount=baseAmount+surchargeAmount+fixedFee+handlingFee;
  if(totalAmount<=0)return null;return {totalAmount,chargeableKg,actualWeightKg:weight,ratePerKg:num(rate.ratePerKg),minimumChargeKg:num(rate.minimumChargeKg),baseAmount,surchargePct:num(rate.surchargePct),surchargeAmount,fixedFee,handlingFee,cutoffWit:normalizeCutoff(rate.cutoffWit)};
}
export function defaultCutoffWit(){return normalizeCutoff();}
