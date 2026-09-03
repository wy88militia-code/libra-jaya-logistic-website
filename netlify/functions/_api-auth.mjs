import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { createOperationalNotification } from './_notification-core.mjs';
import { consumeApiRequestQuota, enforceApiPolicyPreAuth } from './_api-policy-core.mjs';
import { resolvePartnerApiCredential } from './_partner-core.mjs';

const SECURITY_STORE='libra-api-security';
const LOG_STORE='libra-api-logs';
const UAT_STORE='libra-api-uat';
function safeEqual(a,b){const left=Buffer.from(String(a||''));const right=Buffer.from(String(b||''));return left.length===right.length&&crypto.timingSafeEqual(left,right);}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function hmac(value,secret){return crypto.createHmac('sha256',secret).update(value).digest('base64url');}
function now(){return new Date().toISOString();}
export function signatureFor({method,path,timestamp,nonce,bodyText},secret){const canonical=`${String(method||'GET').toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${sha256(bodyText||'')}`;return hmac(canonical,secret);}
export function apiHttpStatus(error,fallback=400){if(Number.isFinite(Number(error?.httpStatus)))return Number(error.httpStatus);const code=String(error?.code||'');if(code==='INSUFFICIENT_BALANCE')return 402;if(code==='QUOTE_NOT_FOUND'||code==='ROUTE_NOT_FOUND')return 404;if(code==='QUOTE_FORBIDDEN')return 403;if(code.startsWith('API_'))return 401;return fallback;}

async function apiLifecycle(partnerId){try{return await getStore(UAT_STORE).get(`partner/${partnerId}`,{type:'json',consistency:'strong'});}catch{return null;}}

export async function authenticateApiRequest(request){
  const apiKey=String(request.headers.get('x-libra-key')||'').trim();const timestampRaw=String(request.headers.get('x-libra-timestamp')||'').trim();const nonce=String(request.headers.get('x-libra-nonce')||'').trim();const supplied=String(request.headers.get('x-libra-signature')||'').trim();
  if(!apiKey||!timestampRaw||nonce.length<12||!supplied){const e=new Error('Header autentikasi API tidak lengkap.');e.code='API_AUTH_MISSING';throw e;}
  const resolved=await resolvePartnerApiCredential(apiKey);const partner=resolved?.partner;if(!partner||partner.status!=='ACTIVE'||!resolved?.secret){const e=new Error('API key tidak valid atau partner tidak aktif.');e.code='API_KEY_INVALID';throw e;}
  if(partner.portalActivated!==true){const e=new Error('Aktivasi kredensial partner belum diselesaikan. Gunakan link aktivasi dari Admin Libra.');e.code='API_ACTIVATION_REQUIRED';throw e;}
  const environment=String(request.headers.get('x-libra-environment')||'PRODUCTION').trim().toUpperCase();if(!['UAT','PRODUCTION'].includes(environment)){const e=new Error('x-libra-environment harus UAT atau PRODUCTION.');e.code='API_ENVIRONMENT_INVALID';throw e;}
  if(resolved.credentialEnvironment!==environment){const e=new Error(environment==='PRODUCTION'?'Gunakan Production API Key untuk request live. Kredensial UAT tidak berlaku di Production.':'Gunakan UAT API Key untuk request UAT. Kredensial Production tidak berlaku di sandbox.');e.code='API_KEY_ENVIRONMENT_MISMATCH';throw e;}
  const policyContext=await enforceApiPolicyPreAuth(request,partner,environment);
  const lifecycle=await apiLifecycle(partner.partnerId);if(!lifecycle){const e=new Error('Lifecycle UAT partner belum tersedia. Hubungi Admin Libra.');e.code='API_UAT_REQUIRED';throw e;}if(!lifecycle.productionEnabled&&environment!=='UAT'){const e=new Error('Production API belum aktif. Gunakan x-libra-environment: UAT selama pengujian.');e.code='API_PRODUCTION_LOCKED';throw e;}
  if(environment==='PRODUCTION'&&!partner.productionCredentialsClaimedAt){const e=new Error('Kredensial Production belum diambil melalui Dashboard API Partner.');e.code='API_PRODUCTION_CREDENTIALS_NOT_CLAIMED';throw e;}
  let timestamp=Number(timestampRaw);if(timestamp>1e12)timestamp=Math.floor(timestamp/1000);const current=Math.floor(Date.now()/1000);if(!Number.isFinite(timestamp)||Math.abs(current-timestamp)>300){const e=new Error('Timestamp API di luar toleransi 5 menit.');e.code='API_TIMESTAMP_INVALID';throw e;}
  const bodyText=await request.text();const url=new URL(request.url);const path=`${url.pathname}${url.search}`;const expected=signatureFor({method:request.method,path,timestamp:timestampRaw,nonce,bodyText},resolved.secret);if(!safeEqual(supplied,expected)){const e=new Error('Signature API tidak valid.');e.code='API_SIGNATURE_INVALID';throw e;}
  const security=getStore(SECURITY_STORE);const dateBucket=new Date().toISOString().slice(0,10);const nonceKey=`nonce/${dateBucket}/${partner.partnerId}/${environment}/${nonce}`;const nonceResult=await security.set(nonceKey,String(current),{onlyIfNew:true});if(!nonceResult.modified){const e=new Error('Nonce sudah pernah digunakan.');e.code='API_REPLAY_BLOCKED';throw e;}
  let json=null;if(bodyText){try{json=JSON.parse(bodyText);}catch{const e=new Error('Body JSON tidak valid.');e.code='INVALID_JSON';throw e;}}
  const usage=await consumeApiRequestQuota(partner.partnerId,environment,policyContext.policy);
  return {partner,bodyText,json,url,method:request.method.toUpperCase(),nonce,timestamp,environment,lifecycle,credentialEnvironment:resolved.credentialEnvironment,policy:policyContext.policy,clientIp:policyContext.clientIp,usage,requestId:`API-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`};
}
export async function writeApiLog(context,{status,action,reference=null,error=null}={}){
  if(!context?.partner)return;const createdAt=now();const numericStatus=Number(status)||0;const log={requestId:context.requestId,partnerId:context.partner.partnerId,environment:context.environment||'PRODUCTION',method:context.method,path:context.url?`${context.url.pathname}${context.url.search}`:null,action:action||null,status:numericStatus,reference,error:error?String(error).slice(0,500):null,clientIp:context.clientIp||null,createdAt};await getStore(LOG_STORE).setJSON(`log/${context.partner.partnerId}/${createdAt}-${context.requestId}`,log,{onlyIfNew:true});
  if(numericStatus>=500){try{const hour=createdAt.slice(0,13);await createOperationalNotification({partnerId:context.partner.partnerId,type:'API_5XX',severity:'CRITICAL',title:`API 5xx ${context.partner.partnerId}`,message:`${context.method} ${log.path} menghasilkan HTTP ${numericStatus}${log.error?` (${log.error})`:''}. Periksa health dashboard dan log integrasi.`,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-api-security',dedupeKey:`api5xx:${context.partner.partnerId}:${action||'request'}:${hour}`});}catch{}}
}
export async function listApiLogs(limit=300){const store=getStore(LOG_STORE);const {blobs}=await store.list({prefix:'log/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(limit,2000)));const rows=[];for(const blob of selected){const row=await store.get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;}
export async function listApiLogsForPartner(partnerId,limit=300){const id=String(partnerId||'').trim().toUpperCase();if(!id)return [];const store=getStore(LOG_STORE);const {blobs}=await store.list({prefix:`log/${id}/`});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(limit,2000)));const rows=[];for(const blob of selected){const row=await store.get(blob.key,{type:'json'});if(row)rows.push(row);}return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
