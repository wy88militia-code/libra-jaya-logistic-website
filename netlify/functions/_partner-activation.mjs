import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getOnboardingApplication, getUatRecord } from './_api-uat-core.mjs';
import { getPartner, newPinHash, normalizePartnerId, savePartner } from './_partner-core.mjs';

const STORE='libra-partner-activation';
const store=()=>getStore(STORE);
const now=()=>new Date().toISOString();
const sha256=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
const safeEqualHex=(a,b)=>{const x=Buffer.from(String(a||''),'hex');const y=Buffer.from(String(b||''),'hex');return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y);};

async function revokeCurrent(partnerId){
  const id=normalizePartnerId(partnerId);const currentId=await store().get(`current/${id}`,{type:'text',consistency:'strong'});if(!currentId)return;
  const current=await store().get(`activation/${currentId}`,{type:'json',consistency:'strong'});if(current&&['PENDING','CLAIMING'].includes(current.status))await store().setJSON(`activation/${currentId}`,{...current,status:'REVOKED',revokedAt:now(),updatedAt:now()});
}

export async function createPartnerActivation(partnerId,applicationId,{ttlHours=72}={}){
  const id=normalizePartnerId(partnerId);const partner=await getPartner(id);if(!partner)throw new Error('Partner tidak ditemukan.');
  const uat=await getUatRecord(id);if(!uat)throw new Error('Lifecycle UAT partner belum tersedia.');
  await revokeCurrent(id);
  const activationId=`ACT-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const token=crypto.randomBytes(32).toString('base64url');const createdAt=now();const expiresAt=new Date(Date.now()+Math.max(1,Math.min(Number(ttlHours)||72,168))*60*60*1000).toISOString();
  const row={activationId,partnerId:id,applicationId:String(applicationId||uat.applicationId||partner.onboardingApplicationId||'').trim(),tokenHash:sha256(token),status:'PENDING',createdAt,updatedAt:createdAt,expiresAt,claimedAt:null,claimIpHash:null};
  await store().setJSON(`activation/${activationId}`,row,{onlyIfNew:true});await store().set(`current/${id}`,activationId);return {activationId,token,expiresAt,partnerId:id};
}

export async function inspectPartnerActivation(activationId,token){
  const key=`activation/${String(activationId||'').trim()}`;const row=await store().get(key,{type:'json',consistency:'strong'});if(!row)throw new Error('Link aktivasi tidak ditemukan.');
  if(!safeEqualHex(sha256(token),row.tokenHash)){const e=new Error('Token aktivasi tidak valid.');e.code='INVALID_TOKEN';throw e;}
  if(row.status!=='PENDING'){const e=new Error(row.status==='CLAIMED'?'Link aktivasi sudah digunakan.':'Link aktivasi tidak aktif.');e.code='ACTIVATION_NOT_ACTIVE';throw e;}
  if(new Date(row.expiresAt).getTime()<=Date.now()){await store().setJSON(key,{...row,status:'EXPIRED',updatedAt:now()});const e=new Error('Link aktivasi sudah kedaluwarsa. Minta Admin Libra membuat link baru.');e.code='ACTIVATION_EXPIRED';throw e;}
  const partner=await getPartner(row.partnerId);const application=row.applicationId?await getOnboardingApplication(row.applicationId):null;
  return {activationId:row.activationId,partnerId:row.partnerId,companyName:partner?.companyName||application?.companyName||'',picName:partner?.picName||application?.picName||'',email:partner?.email||application?.email||'',expiresAt:row.expiresAt,status:row.status};
}

export async function claimPartnerActivation({activationId,token,pin,ipAddress=''}){
  const key=`activation/${String(activationId||'').trim()}`;const entry=await store().getWithMetadata(key,{type:'json',consistency:'strong'});const row=entry?.data;if(!row)throw new Error('Link aktivasi tidak ditemukan.');
  if(!safeEqualHex(sha256(token),row.tokenHash)){const e=new Error('Token aktivasi tidak valid.');e.code='INVALID_TOKEN';throw e;}
  if(row.status!=='PENDING'){const e=new Error(row.status==='CLAIMED'?'Link aktivasi sudah digunakan.':'Link aktivasi tidak aktif.');e.code='ACTIVATION_NOT_ACTIVE';throw e;}
  if(new Date(row.expiresAt).getTime()<=Date.now()){await store().setJSON(key,{...row,status:'EXPIRED',updatedAt:now()},{onlyIfMatch:entry.etag});const e=new Error('Link aktivasi sudah kedaluwarsa. Minta Admin Libra membuat link baru.');e.code='ACTIVATION_EXPIRED';throw e;}
  const cleanPin=String(pin||'').trim();if(!/^\d{6}$/.test(cleanPin))throw new Error('PIN portal harus 6 digit.');
  const claiming={...row,status:'CLAIMING',claimStartedAt:now(),updatedAt:now()};const lock=await store().setJSON(key,claiming,{onlyIfMatch:entry.etag});if(!lock.modified){const e=new Error('Link aktivasi sedang diproses atau sudah digunakan.');e.code='ACTIVATION_BUSY';throw e;}
  try{
    const partner=await getPartner(row.partnerId);if(!partner)throw new Error('Data partner tidak ditemukan.');const uat=await getUatRecord(row.partnerId);if(!uat)throw new Error('Data UAT partner tidak ditemukan.');
    const activatedAt=now();await savePartner({...partner,...newPinHash(cleanPin),portalActivated:true,portalActivatedAt:activatedAt,updatedAt:activatedAt});
    const app=row.applicationId?await getOnboardingApplication(row.applicationId):null;if(app)await getStore('libra-api-onboarding').setJSON(`application/${app.applicationId}`,{...app,credentialsClaimedAt:activatedAt,portalActivatedAt:activatedAt,updatedAt:activatedAt});
    const claimed={...claiming,status:'CLAIMED',claimedAt:activatedAt,claimIpHash:ipAddress?sha256(ipAddress):null,updatedAt:activatedAt};await store().setJSON(key,claimed);
    return {partnerId:partner.partnerId,companyName:partner.companyName,environment:'UAT',apiKey:partner.apiKey,apiSecret:partner.apiSecret,webhookSecret:uat.webhookSecret||null,claimedAt:activatedAt};
  }catch(error){const latest=await store().get(key,{type:'json',consistency:'strong'});if(latest?.status==='CLAIMING')await store().setJSON(key,{...latest,status:'PENDING',lastError:String(error?.message||error).slice(0,300),updatedAt:now()});throw error;}
}

export async function getCurrentActivationStatus(partnerId){
  const id=normalizePartnerId(partnerId);if(!id)return null;const activationId=await store().get(`current/${id}`,{type:'text',consistency:'strong'});if(!activationId)return null;const row=await store().get(`activation/${activationId}`,{type:'json',consistency:'strong'});if(!row)return null;return {activationId:row.activationId,status:row.status,expiresAt:row.expiresAt,claimedAt:row.claimedAt||null,createdAt:row.createdAt};
}
