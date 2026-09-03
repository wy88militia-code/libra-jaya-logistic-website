import net from 'node:net';
import { getStore } from '@netlify/blobs';
import { createOperationalNotification } from './_notification-core.mjs';
import { getPartner, normalizePartnerId } from './_partner-core.mjs';

const POLICY_STORE='libra-api-policies';
const SECURITY_STORE='libra-api-security';
const policyStore=()=>getStore(POLICY_STORE);
const securityStore=()=>getStore(SECURITY_STORE);
const now=()=>new Date().toISOString();
const integer=(value,fallback,min=0,max=1000000000)=>{const n=Math.trunc(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
const clean=(value,max=200)=>String(value??'').trim().slice(0,max);

export function defaultApiPolicy(partnerId){
  return {partnerId:normalizePartnerId(partnerId),apiStatus:'ACTIVE',ipAllowlist:[],requestsPerMinute:120,dailyRequestQuota:10000,monthlyRequestQuota:200000,dailyBookingQuota:1000,monthlyBookingQuota:20000,bookingSpike15m:100,duplicateAlert10m:10,maxBookingAmount:0,createdAt:null,updatedAt:null,updatedBy:null};
}
function normalizeIpAllowlist(value){
  const raw=Array.isArray(value)?value:String(value||'').split(/[\s,;]+/);const unique=[];
  for(const item of raw){const rule=clean(item,80);if(!rule)continue;if(rule.includes('/')){const [ip,prefixRaw]=rule.split('/');const family=net.isIP(ip);const prefix=Number(prefixRaw);if(family===4&&Number.isInteger(prefix)&&prefix>=0&&prefix<=32)unique.push(`${ip}/${prefix}`);else if(family===6&&Number.isInteger(prefix)&&prefix>=0&&prefix<=128)unique.push(`${ip.toLowerCase()}/${prefix}`);else throw new Error(`IP/CIDR tidak valid: ${rule}`);}else{if(!net.isIP(rule))throw new Error(`IP tidak valid: ${rule}`);unique.push(rule.toLowerCase());}}
  return [...new Set(unique)].slice(0,100);
}
function normalizePolicy(partnerId,input={},current=null,adminUser='admin'){
  const base=current||defaultApiPolicy(partnerId);const stamp=now();
  return {...base,partnerId:normalizePartnerId(partnerId),apiStatus:String(input.apiStatus??base.apiStatus).toUpperCase()==='SUSPENDED'?'SUSPENDED':'ACTIVE',ipAllowlist:input.ipAllowlist!==undefined?normalizeIpAllowlist(input.ipAllowlist):base.ipAllowlist||[],requestsPerMinute:integer(input.requestsPerMinute,base.requestsPerMinute,10,10000),dailyRequestQuota:integer(input.dailyRequestQuota,base.dailyRequestQuota,100,10000000),monthlyRequestQuota:integer(input.monthlyRequestQuota,base.monthlyRequestQuota,1000,100000000),dailyBookingQuota:integer(input.dailyBookingQuota,base.dailyBookingQuota,1,1000000),monthlyBookingQuota:integer(input.monthlyBookingQuota,base.monthlyBookingQuota,1,10000000),bookingSpike15m:integer(input.bookingSpike15m,base.bookingSpike15m,5,100000),duplicateAlert10m:integer(input.duplicateAlert10m,base.duplicateAlert10m,3,100000),maxBookingAmount:integer(input.maxBookingAmount,base.maxBookingAmount,0,100000000000),createdAt:base.createdAt||stamp,updatedAt:stamp,updatedBy:clean(adminUser,80)};
}
export async function getApiPolicy(partnerId){const id=normalizePartnerId(partnerId);if(!id)return null;const saved=await policyStore().get(`partner/${id}`,{type:'json',consistency:'strong'});return saved||defaultApiPolicy(id);}
export async function listApiPolicies(){const {blobs}=await policyStore().list({prefix:'partner/'});const rows=[];for(const blob of blobs){const row=await policyStore().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows.sort((a,b)=>String(a.partnerId).localeCompare(String(b.partnerId)));}
export async function ensureApiPolicy(partnerId,adminUser='system'){const id=normalizePartnerId(partnerId);if(!id)throw new Error('Partner ID tidak valid.');const existing=await policyStore().get(`partner/${id}`,{type:'json',consistency:'strong'});if(existing)return existing;const policy=normalizePolicy(id,{},null,adminUser);await policyStore().setJSON(`partner/${id}`,policy,{onlyIfNew:true});return (await policyStore().get(`partner/${id}`,{type:'json',consistency:'strong'}))||policy;}
export async function saveApiPolicy(partnerId,input={},adminUser='admin'){const id=normalizePartnerId(partnerId);if(!id||!await getPartner(id))throw new Error('Partner tidak ditemukan.');const current=await getApiPolicy(id);const policy=normalizePolicy(id,input,current,adminUser);await policyStore().setJSON(`partner/${id}`,policy);return policy;}

function ipToBigInt(ip){
  if(net.isIP(ip)===4)return BigInt(ip.split('.').reduce((acc,n)=>(acc*256)+Number(n),0));
  if(net.isIP(ip)!==6)return null;let value=String(ip).toLowerCase();if(value.includes('.')){const idx=value.lastIndexOf(':');const v4=value.slice(idx+1);if(net.isIP(v4)===4){const p=v4.split('.').map(Number);value=value.slice(0,idx+1)+((p[0]<<8)|p[1]).toString(16)+':'+((p[2]<<8)|p[3]).toString(16);}}
  const halves=value.split('::');const left=halves[0]?halves[0].split(':').filter(Boolean):[];const right=halves[1]?halves[1].split(':').filter(Boolean):[];const missing=8-left.length-right.length;const parts=[...left,...Array(Math.max(0,missing)).fill('0'),...right];if(parts.length!==8)return null;let out=0n;for(const part of parts){const n=parseInt(part||'0',16);if(!Number.isFinite(n)||n<0||n>65535)return null;out=(out<<16n)+BigInt(n);}return out;
}
function ipMatchesRule(ip,rule){
  if(!rule.includes('/'))return String(ip).toLowerCase()===String(rule).toLowerCase();const [base,prefixRaw]=rule.split('/');const family=net.isIP(ip);if(!family||family!==net.isIP(base))return false;const bits=family===4?32:128;const prefix=Number(prefixRaw);const a=ipToBigInt(ip),b=ipToBigInt(base);if(a===null||b===null)return false;if(prefix===0)return true;const shift=BigInt(bits-prefix);return (a>>shift)===(b>>shift);
}
export function getClientIp(request){const direct=clean(request.headers.get('x-nf-client-connection-ip'),100);if(net.isIP(direct))return direct;const forwarded=String(request.headers.get('x-forwarded-for')||'').split(',')[0].trim();return net.isIP(forwarded)?forwarded:'';}
function apiError(code,message,status=403){const e=new Error(message);e.code=code;e.httpStatus=status;return e;}
export async function enforceApiPolicyPreAuth(request,partner,environment){
  const policy=await getApiPolicy(partner.partnerId);if(policy.apiStatus==='SUSPENDED')throw apiError('API_SUSPENDED','Akses API partner sedang dihentikan Admin Libra.',403);
  const clientIp=getClientIp(request);if(environment==='PRODUCTION'&&Array.isArray(policy.ipAllowlist)&&policy.ipAllowlist.length){if(!clientIp||!policy.ipAllowlist.some(rule=>ipMatchesRule(clientIp,rule)))throw apiError('API_IP_NOT_ALLOWED','IP sumber tidak termasuk allowlist Production API partner.',403);}
  return {policy,clientIp};
}
function buckets(){const d=new Date(Date.now()+9*60*60*1000);const iso=d.toISOString();const minute=d.getUTCMinutes();return {minute:iso.slice(0,16),day:iso.slice(0,10),month:iso.slice(0,7),quarterHour:`${iso.slice(0,13)}:${String(Math.floor(minute/15)*15).padStart(2,'0')}`,tenMinute:`${iso.slice(0,14)}${Math.floor(minute/10)}`};}
async function incrementCounter(key,limit,code,message){
  const store=securityStore();for(let attempt=0;attempt<8;attempt+=1){const entry=await store.getWithMetadata(key,{type:'json',consistency:'strong'});const current=entry?.data||{count:0};if(limit>0&&Number(current.count)>=limit)throw apiError(code,message,429);const next={count:Number(current.count||0)+1,updatedAt:now()};const result=await store.setJSON(key,next,entry?{onlyIfMatch:entry.etag}:{onlyIfNew:true});if(result.modified)return next.count;}throw apiError('API_USAGE_BUSY','Penghitung quota sedang sibuk. Coba kembali.',503);
}
async function readCounter(key){const row=await securityStore().get(key,{type:'json',consistency:'strong'});return Number(row?.count||0);}
async function notifyLimit(partnerId,type,title,message,dedupeKey){try{await createOperationalNotification({partnerId,type,severity:'WARNING',title,message,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-api-security',dedupeKey});}catch{}}
export async function consumeApiRequestQuota(partnerId,environment,policy=null){
  const id=normalizePartnerId(partnerId);const p=policy||await getApiPolicy(id);const b=buckets();try{const minute=await incrementCounter(`usage/${id}/${environment}/request/minute/${b.minute}`,p.requestsPerMinute,'API_RATE_LIMITED',`Batas ${p.requestsPerMinute} request/menit terlampaui.`);const day=await incrementCounter(`usage/${id}/${environment}/request/day/${b.day}`,p.dailyRequestQuota,'API_DAILY_QUOTA_EXCEEDED','Quota request harian terlampaui.');const month=await incrementCounter(`usage/${id}/${environment}/request/month/${b.month}`,p.monthlyRequestQuota,'API_MONTHLY_QUOTA_EXCEEDED','Quota request bulanan terlampaui.');return {minute,day,month};}catch(error){await notifyLimit(id,'API_QUOTA',`API quota diblokir: ${id}`,error.message,`quota:${id}:${environment}:${error.code}:${b.minute}`);throw error;}
}
export async function consumeBookingQuota(partnerId,environment,policy=null,amount=0){
  const id=normalizePartnerId(partnerId);const p=policy||await getApiPolicy(id);if(p.maxBookingAmount>0&&Number(amount)>p.maxBookingAmount)throw apiError('API_BOOKING_AMOUNT_LIMIT',`Nilai booking melebihi batas Rp${Number(p.maxBookingAmount).toLocaleString('id-ID')}.`,422);const b=buckets();try{const day=await incrementCounter(`usage/${id}/${environment}/booking/day/${b.day}`,p.dailyBookingQuota,'API_DAILY_BOOKING_QUOTA_EXCEEDED','Quota booking harian terlampaui.');const month=await incrementCounter(`usage/${id}/${environment}/booking/month/${b.month}`,p.monthlyBookingQuota,'API_MONTHLY_BOOKING_QUOTA_EXCEEDED','Quota booking bulanan terlampaui.');const quarter=await incrementCounter(`signal/${id}/${environment}/booking/15m/${b.quarterHour}`,0,'','','');if(quarter===p.bookingSpike15m){await createOperationalNotification({partnerId:id,type:'API_BOOKING_SPIKE',severity:'CRITICAL',title:`Lonjakan booking API ${id}`,message:`Terdeteksi ${quarter} booking attempt dalam 15 menit pada environment ${environment}. Periksa integrasi/fraud sebelum menaikkan quota.`,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-api-security',dedupeKey:`spike:${id}:${environment}:${b.quarterHour}`});}return {day,month,quarter};}catch(error){if(error?.code?.includes('QUOTA'))await notifyLimit(id,'API_BOOKING_QUOTA',`Booking quota diblokir: ${id}`,error.message,`booking-quota:${id}:${environment}:${error.code}:${b.day}`);throw error;}
}
export async function recordDuplicateBookingSignal(partnerId,environment,policy=null){const id=normalizePartnerId(partnerId);const p=policy||await getApiPolicy(id);const b=buckets();const count=await incrementCounter(`signal/${id}/${environment}/duplicate/10m/${b.tenMinute}`,0,'','','');if(count===p.duplicateAlert10m){await createOperationalNotification({partnerId:id,type:'API_DUPLICATE_SPIKE',severity:'WARNING',title:`Duplicate booking meningkat: ${id}`,message:`Terdeteksi ${count} retry/duplicate booking dalam sekitar 10 menit. Idempotency tetap melindungi debit ganda, tetapi integrasi partner perlu diperiksa.`,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-api-security',dedupeKey:`duplicate:${id}:${environment}:${b.tenMinute}`});}return count;}
export async function getApiUsageSnapshot(partnerId,environment='PRODUCTION'){const id=normalizePartnerId(partnerId);const b=buckets();return {requestMinute:await readCounter(`usage/${id}/${environment}/request/minute/${b.minute}`),requestDay:await readCounter(`usage/${id}/${environment}/request/day/${b.day}`),requestMonth:await readCounter(`usage/${id}/${environment}/request/month/${b.month}`),bookingDay:await readCounter(`usage/${id}/${environment}/booking/day/${b.day}`),bookingMonth:await readCounter(`usage/${id}/${environment}/booking/month/${b.month}`)};}
