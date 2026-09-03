import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { getStore } from '@netlify/blobs';
import { normalizePartnerId } from './_partner-core.mjs';

const UAT_STORE='libra-api-uat';
const ONBOARDING_STORE='libra-api-onboarding';
const DELIVERY_STORE='libra-webhook-deliveries';
const MAX_ATTEMPTS=5;
const REQUEST_TIMEOUT_MS=8000;
const RETRY_DELAYS_MS=[60_000,5*60_000,20*60_000,60*60_000,3*60*60_000];
const now=()=>new Date().toISOString();
const uatStore=()=>getStore(UAT_STORE);
const onboardingStore=()=>getStore(ONBOARDING_STORE);
const deliveryStore=()=>getStore(DELIVERY_STORE);
const safeEqual=(a,b)=>{const x=Buffer.from(String(a||''));const y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const hmac=(secret,value)=>crypto.createHmac('sha256',secret).update(value).digest('base64url');

function isPrivateIpv4(ip){
  const p=ip.split('.').map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return true;
  const [a,b]=p;
  return a===0||a===10||a===127||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))||a>=224;
}
function isPrivateIpv6(ip){
  const s=String(ip||'').toLowerCase();
  if(s==='::'||s==='::1')return true;
  if(s.startsWith('fc')||s.startsWith('fd')||s.startsWith('fe8')||s.startsWith('fe9')||s.startsWith('fea')||s.startsWith('feb'))return true;
  if(s.startsWith('::ffff:')){const v4=s.slice(7);return net.isIP(v4)===4?isPrivateIpv4(v4):true;}
  return false;
}
function isPrivateIp(ip){const kind=net.isIP(ip);return kind===4?isPrivateIpv4(ip):kind===6?isPrivateIpv6(ip):true;}
async function validateCallbackUrl(raw){
  let url;try{url=new URL(String(raw||'').trim());}catch{throw new Error('Callback URL tidak valid.');}
  if(url.protocol!=='https:')throw new Error('Callback webhook wajib menggunakan HTTPS.');
  if(url.username||url.password)throw new Error('Callback URL tidak boleh memuat username/password.');
  const host=url.hostname.toLowerCase();if(!host||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal'))throw new Error('Hostname callback tidak diizinkan.');
  if(net.isIP(host)){if(isPrivateIp(host))throw new Error('Callback ke IP private/loopback tidak diizinkan.');}
  else{
    let addresses;try{addresses=await dns.lookup(host,{all:true,verbatim:true});}catch{throw new Error('Hostname callback tidak dapat di-resolve.');}
    if(!addresses.length||addresses.some(row=>isPrivateIp(row.address)))throw new Error('Callback hostname mengarah ke jaringan private/terlarang.');
  }
  url.hash='';return url.toString();
}
async function getUatRecord(partnerId){const id=normalizePartnerId(partnerId);if(!id)return null;return uatStore().get(`partner/${id}`,{type:'json',consistency:'strong'});}
async function saveUatRecord(record){const id=normalizePartnerId(record?.partnerId);if(!id)throw new Error('Partner ID webhook tidak valid.');const value={...record,partnerId:id,updatedAt:now()};await uatStore().setJSON(`partner/${id}`,value);return value;}
async function getApplication(applicationId){if(!applicationId)return null;return onboardingStore().get(`application/${String(applicationId).trim()}`,{type:'json',consistency:'strong'});}
export async function getWebhookProfile(partnerId){
  const id=normalizePartnerId(partnerId);const record=await getUatRecord(id);if(!record)return {partnerId:id,record:null,application:null,callbackUrl:'',webhookSecret:'',productionEnabled:false};
  const application=await getApplication(record.applicationId);return {partnerId:id,record,application,callbackUrl:String(application?.callbackUrl||record.callbackUrl||'').trim(),webhookSecret:String(record.webhookSecret||''),productionEnabled:Boolean(record.productionEnabled)};
}
export async function rotateWebhookSecret(partnerId){
  const profile=await getWebhookProfile(partnerId);if(!profile.record)throw new Error('Partner belum memiliki record UAT.');const secret=`whsec_${crypto.randomBytes(32).toString('base64url')}`;await saveUatRecord({...profile.record,webhookSecret:secret,webhookSecretRotatedAt:now(),webhookStatus:'NOT_TESTED',webhookNote:'Webhook secret dirotasi; test ulang callback diperlukan.'});return secret;
}
export function maskWebhookSecret(secret){const s=String(secret||'');return s?`${s.slice(0,9)}…${s.slice(-5)}`:'BELUM DIBUAT';}
function eventTypeForTracking(event){if(event.status==='DELIVERED')return 'shipment.delivered';if(['HELD','DAMAGED','CLAIM_PROCESS'].includes(event.status))return 'shipment.incident';return 'shipment.tracking.updated';}
async function createDelivery({partnerId,eventType,environment,payload,callbackUrl}){
  const deliveryId=`WHD-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;const invokeToken=crypto.randomBytes(24).toString('base64url');const createdAt=now();const bodyPayload={...payload,delivery_id:deliveryId,event:eventType,environment};const delivery={deliveryId,partnerId:normalizePartnerId(partnerId),eventType,environment,callbackUrl,status:'PENDING',attempts:0,maxAttempts:MAX_ATTEMPTS,invokeToken,createdAt,updatedAt:createdAt,nextAttemptAt:createdAt,payload:bodyPayload,lastHttpStatus:null,lastError:null,lastResponse:null,deliveredAt:null};await deliveryStore().setJSON(`delivery/${deliveryId}`,delivery,{onlyIfNew:true});return delivery;
}
export async function queueTrackingWebhook(event,booking){
  const profile=await getWebhookProfile(booking?.partnerId);if(!profile.record||!profile.productionEnabled||!profile.callbackUrl||!profile.webhookSecret)return null;
  const eventType=eventTypeForTracking(event);
  const delivery=await createDelivery({partnerId:booking.partnerId,eventType,environment:'PRODUCTION',callbackUrl:profile.callbackUrl,payload:{created_at:now(),partner_id:booking.partnerId,data:{booking_id:booking.bookingId,status:event.status,occurred_at:event.createdAt,sla:booking.sla||null,note:event.note||null,condition:event.condition||null,claim_status:event.claimStatus||null,claim_reference:event.claimReference||null,pod_available:Boolean(event.podId)}}});
  return {deliveryId:delivery.deliveryId,invokeToken:delivery.invokeToken};
}
async function updateDelivery(delivery){const saved={...delivery,updatedAt:now()};await deliveryStore().setJSON(`delivery/${delivery.deliveryId}`,saved);if(saved.environment==='UAT'&&saved.eventType==='libra.webhook.test'){const record=await getUatRecord(saved.partnerId);if(record){const webhookStatus=saved.status==='DELIVERED'?'PASS':saved.status==='DEAD'?'FAIL':'TESTING';const webhookNote=saved.status==='DELIVERED'?`Callback menerima HTTP ${saved.lastHttpStatus} pada ${saved.deliveredAt}.`:saved.status==='DEAD'?`Callback gagal setelah ${saved.attempts} percobaan: ${saved.lastError||saved.lastHttpStatus||'unknown'}.`:`Callback belum berhasil; retry otomatis dijadwalkan. Attempt ${saved.attempts}/${saved.maxAttempts}.`;await saveUatRecord({...record,webhookStatus,webhookNote,lastWebhookTestAt:record.lastWebhookTestAt||now(),lastWebhookDeliveryId:saved.deliveryId});}}return saved;}
async function sendDelivery(delivery){
  const profile=await getWebhookProfile(delivery.partnerId);if(!profile.record||!profile.webhookSecret)throw new Error('Webhook signing secret partner tidak tersedia.');
  const callbackUrl=await validateCallbackUrl(delivery.callbackUrl||profile.callbackUrl);const bodyText=JSON.stringify(delivery.payload);const timestamp=Math.floor(Date.now()/1000).toString();const signature=`v1=${hmac(profile.webhookSecret,`${timestamp}.${delivery.deliveryId}.${bodyText}`)}`;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(callbackUrl,{method:'POST',headers:{'content-type':'application/json','user-agent':'LibraJayaLogistic-Webhook/1.0','x-libra-event':delivery.eventType,'x-libra-environment':delivery.environment,'x-libra-delivery-id':delivery.deliveryId,'x-libra-timestamp':timestamp,'x-libra-signature':signature},body:bodyText,signal:controller.signal,redirect:'error'});
    const responseText=(await response.text().catch(()=>'' )).slice(0,500);return {ok:response.status>=200&&response.status<300,httpStatus:response.status,responseText};
  }finally{clearTimeout(timer);}
}
export async function processWebhookDelivery(deliveryId,invokeToken=null){
  const store=deliveryStore();const delivery=await store.get(`delivery/${String(deliveryId||'').trim()}`,{type:'json',consistency:'strong'});if(!delivery)throw new Error('Webhook delivery tidak ditemukan.');if(invokeToken&&!safeEqual(invokeToken,delivery.invokeToken))throw new Error('Token delivery tidak valid.');if(delivery.status==='DELIVERED'||delivery.status==='DEAD')return delivery;
  const attempts=Number(delivery.attempts||0)+1;let result,errorMessage='';try{result=await sendDelivery(delivery);}catch(error){errorMessage=error?.name==='AbortError'?'Webhook timeout.':String(error?.message||'Webhook gagal.').slice(0,500);result={ok:false,httpStatus:null,responseText:''};}
  if(result.ok){return updateDelivery({...delivery,status:'DELIVERED',attempts,lastHttpStatus:result.httpStatus,lastResponse:result.responseText,lastError:null,deliveredAt:now(),nextAttemptAt:null});}
  const exhausted=attempts>=MAX_ATTEMPTS;const delay=RETRY_DELAYS_MS[Math.min(attempts-1,RETRY_DELAYS_MS.length-1)];return updateDelivery({...delivery,status:exhausted?'DEAD':'RETRY_PENDING',attempts,lastHttpStatus:result.httpStatus,lastResponse:result.responseText,lastError:errorMessage||`HTTP ${result.httpStatus||'ERR'}`,nextAttemptAt:exhausted?null:new Date(Date.now()+delay).toISOString()});
}
export async function testPartnerWebhook(partnerId){
  const profile=await getWebhookProfile(partnerId);if(!profile.record)throw new Error('Partner belum memiliki record UAT.');if(!profile.callbackUrl)throw new Error('Callback/Webhook URL belum diisi pada pengajuan onboarding.');if(!profile.webhookSecret)throw new Error('Webhook signing secret belum dibuat. Gunakan Rotate/Buat Secret terlebih dahulu.');const callbackUrl=await validateCallbackUrl(profile.callbackUrl);
  const eventType='libra.webhook.test';const delivery=await createDelivery({partnerId:profile.partnerId,eventType,environment:'UAT',callbackUrl,payload:{created_at:now(),partner_id:profile.partnerId,data:{message:'Libra API webhook connectivity test',expected_response:'HTTP 2xx'}}});await saveUatRecord({...profile.record,webhookStatus:'TESTING',webhookNote:'Callback test sedang dijalankan.',lastWebhookTestAt:now(),lastWebhookDeliveryId:delivery.deliveryId});return processWebhookDelivery(delivery.deliveryId,delivery.invokeToken);
}
export async function listWebhookDeliveries(partnerId,limit=20){
  const id=normalizePartnerId(partnerId);if(!id)return [];const store=deliveryStore();const {blobs}=await store.list({prefix:'delivery/'});const rows=[];for(const blob of blobs.sort((a,b)=>b.key.localeCompare(a.key))){const row=await store.get(blob.key,{type:'json'});if(row?.partnerId===id)rows.push(row);if(rows.length>=Math.max(1,Math.min(limit,100)))break;}return rows;
}
export async function retryDueWebhookDeliveries(limit=10){
  const store=deliveryStore();const {blobs}=await store.list({prefix:'delivery/'});const current=Date.now();const due=[];for(const blob of blobs){const row=await store.get(blob.key,{type:'json'});if(!row||!['PENDING','RETRY_PENDING'].includes(row.status))continue;if(row.nextAttemptAt&&new Date(row.nextAttemptAt).getTime()>current)continue;due.push(row);if(due.length>=Math.max(1,Math.min(limit,20)))break;}return Promise.all(due.map(async row=>{try{return await processWebhookDelivery(row.deliveryId);}catch(error){return {deliveryId:row.deliveryId,status:'ERROR',lastError:String(error?.message||error)};}}));
}
