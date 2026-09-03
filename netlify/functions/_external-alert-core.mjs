import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getPartner } from './_partner-core.mjs';

const STORE='libra-external-alerts';
const store=()=>getStore(STORE);
const now=()=>new Date().toISOString();
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const normalizePartnerId=value=>String(value??'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,40);
const emailList=value=>[...new Set(String(value||'').split(/[;,\s]+/).map(v=>v.trim().toLowerCase()).filter(v=>v&&v.includes('@')))].slice(0,20);
const phoneList=value=>[...new Set(String(value||'').split(/[;,\s]+/).map(v=>v.replace(/\D/g,'')).filter(v=>v.length>=8&&v.length<=16))].slice(0,20);
const alertId=()=>`XAL-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const bookingThreshold=()=>Math.max(0,Math.trunc(Number(process.env.EXTERNAL_ALERT_BOOKING_AMOUNT_THRESHOLD)||10000000));
const retryMs=[60_000,5*60_000,30*60_000,2*60*60_000,12*60*60_000];

function config(){
  const email={apiKey:String(process.env.RESEND_API_KEY||'').trim(),from:clean(process.env.ALERT_EMAIL_FROM,200),adminTo:emailList(process.env.ALERT_ADMIN_EMAILS)};email.configured=Boolean(email.apiKey&&email.from);
  const whatsapp={accessToken:String(process.env.WHATSAPP_ACCESS_TOKEN||'').trim(),phoneNumberId:clean(process.env.WHATSAPP_PHONE_NUMBER_ID,100),adminTo:phoneList(process.env.ALERT_ADMIN_WHATSAPP_NUMBERS),templateName:clean(process.env.WHATSAPP_ALERT_TEMPLATE_NAME,120),language:clean(process.env.WHATSAPP_ALERT_TEMPLATE_LANG,20)||'id',graphVersion:clean(process.env.WHATSAPP_GRAPH_VERSION,20)||'v23.0'};whatsapp.configured=Boolean(whatsapp.accessToken&&whatsapp.phoneNumberId&&whatsapp.templateName);
  return {email,whatsapp,anyConfigured:email.configured||whatsapp.configured,bookingAmountThreshold:bookingThreshold()};
}
export function externalAlertConfig(){const c=config();return {email:{configured:c.email.configured,from:c.email.from||null,adminRecipients:c.email.adminTo.length},whatsapp:{configured:c.whatsapp.configured,phoneNumberId:c.whatsapp.phoneNumberId||null,adminRecipients:c.whatsapp.adminTo.length,templateName:c.whatsapp.templateName||null,language:c.whatsapp.language,graphVersion:c.whatsapp.graphVersion},bookingAmountThreshold:c.bookingAmountThreshold};}

function deliveryPolicy(notification,force=false){
  const type=String(notification?.type||'').toUpperCase(),severity=String(notification?.severity||'INFO').toUpperCase(),audience=String(notification?.audience||'');const isPartner=audience.startsWith('partner/');const amount=Number(notification?.metadata?.amount)||0;
  if(force)return {queue:true,email:true,whatsapp:true};
  if(notification?.external===false)return {queue:false,email:false,whatsapp:false};
  if(type==='BOOKING_CREATED')return {queue:amount>=bookingThreshold(),email:amount>=bookingThreshold(),whatsapp:amount>=bookingThreshold()};
  if(type==='DELIVERED')return {queue:isPartner,email:isPartner,whatsapp:isPartner};
  if(['INCIDENT','LOW_BALANCE','API_SECURITY_STATUS','UAT_FINAL_DECISION','PRODUCTION_ACTIVE','WEBHOOK_DEAD','WEBHOOK_QUEUE_ERROR','API_BOOKING_SPIKE','API_5XX','BACKUP_OFFSITE_FAILED','BACKUP_FAILED','RESTORE_COMPLETED'].includes(type))return {queue:true,email:true,whatsapp:true};
  if(['WEBHOOK_RETRY','API_QUOTA','API_BOOKING_QUOTA','API_DUPLICATE_SPIKE'].includes(type))return {queue:true,email:true,whatsapp:severity==='CRITICAL'};
  if(severity==='CRITICAL')return {queue:true,email:true,whatsapp:true};
  return {queue:false,email:false,whatsapp:false};
}

async function recipientInfo(notification){
  const c=config();const audience=String(notification.audience||'');if(audience==='admin')return {emails:c.email.adminTo,phones:c.whatsapp.adminTo};
  if(audience.startsWith('partner/')){const partnerId=normalizePartnerId(notification.partnerId||audience.slice(8));const partner=partnerId?await getPartner(partnerId):null;return {emails:partner?.email&&String(partner.email).includes('@')?[String(partner.email).trim().toLowerCase()]:[],phones:partner?.phone?[String(partner.phone).replace(/\D/g,'')].filter(v=>v.length>=8):[]};}
  return {emails:[],phones:[]};
}
function initialChannel(wanted){return wanted?{status:'PENDING',attempts:0,lastError:null,lastAttemptAt:null,deliveredAt:null,providerId:null}:{status:'NOT_REQUESTED',attempts:0,lastError:null,lastAttemptAt:null,deliveredAt:null,providerId:null};}

export async function queueExternalAlert(notification,{force=false}={}){
  const c=config();if(!c.anyConfigured&&!force)return null;const policy=deliveryPolicy(notification,force);if(!policy.queue)return null;const id=alertId(),createdAt=now();const record={alertId:id,notificationId:notification.notificationId||null,audience:clean(notification.audience,100),partnerId:normalizePartnerId(notification.partnerId)||null,type:clean(notification.type,80),severity:clean(notification.severity,20)||'INFO',title:clean(notification.title,180),message:clean(notification.message,1500),reference:clean(notification.reference,180)||null,link:clean(notification.link,500)||null,metadata:notification.metadata&&typeof notification.metadata==='object'?notification.metadata:null,status:'PENDING',attempts:0,maxAttempts:5,nextAttemptAt:createdAt,email:initialChannel(policy.email),whatsapp:initialChannel(policy.whatsapp),createdAt,updatedAt:createdAt};await store().setJSON(`alert/${createdAt}-${id}`,record,{onlyIfNew:true});return record;
}
async function save(record){const next={...record,updatedAt:now()};await store().setJSON(`alert/${record.createdAt}-${record.alertId}`,next);return next;}

function bodyText(record){const lines=[`LIBRA JAYA LOGISTIC — ${record.severity}`,record.title,record.message];if(record.reference)lines.push(`Referensi: ${record.reference}`);if(record.link)lines.push(`Buka: ${record.link}`);lines.push(`Waktu: ${record.createdAt}`);return lines.filter(Boolean).join('\n');}
async function sendEmail(record,recipients){
  const c=config();if(!c.email.configured)return {status:'SKIPPED_NOT_CONFIGURED'};if(!recipients.length)return {status:'SKIPPED_NO_RECIPIENT'};const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${c.email.apiKey}`,'content-type':'application/json'},body:JSON.stringify({from:c.email.from,to:recipients,subject:`[LIBRA][${record.severity}] ${record.title}`.slice(0,180),text:bodyText(record)})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result?.message||result?.error?.message||`Resend HTTP ${response.status}`);return {status:'DELIVERED',providerId:result?.id||null};
}
async function sendWhatsApp(record,recipients){
  const c=config();if(!c.whatsapp.configured)return {status:'SKIPPED_NOT_CONFIGURED'};if(!recipients.length)return {status:'SKIPPED_NO_RECIPIENT'};const results=[];for(const to of recipients){const response=await fetch(`https://graph.facebook.com/${c.whatsapp.graphVersion}/${encodeURIComponent(c.whatsapp.phoneNumberId)}/messages`,{method:'POST',headers:{authorization:`Bearer ${c.whatsapp.accessToken}`,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'template',template:{name:c.whatsapp.templateName,language:{code:c.whatsapp.language},components:[{type:'body',parameters:[{type:'text',text:record.title.slice(0,200)},{type:'text',text:record.message.slice(0,800)},{type:'text',text:String(record.reference||'-').slice(0,200)}]}]}})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result?.error?.message||`WhatsApp HTTP ${response.status}`);results.push(result?.messages?.[0]?.id||null);}return {status:'DELIVERED',providerId:results.filter(Boolean).join(',')||null};
}
function channelDone(channel){return ['DELIVERED','SKIPPED_NOT_CONFIGURED','SKIPPED_NO_RECIPIENT','NOT_REQUESTED'].includes(channel?.status);}
async function attemptChannel(record,name,send,recipients){const current=record[name];if(channelDone(current))return current;try{const result=await send(record,recipients);return {...current,...result,attempts:Number(current.attempts||0)+1,lastAttemptAt:now(),lastError:null,deliveredAt:result.status==='DELIVERED'?now():current.deliveredAt};}catch(error){return {...current,status:'FAILED',attempts:Number(current.attempts||0)+1,lastAttemptAt:now(),lastError:String(error?.message||error).slice(0,500)};}}
export async function processExternalAlert(record){
  if(!record||['DELIVERED','DEAD','SKIPPED'].includes(record.status))return record;const recipients=await recipientInfo(record);const email=await attemptChannel(record,'email',sendEmail,recipients.emails);const whatsapp=await attemptChannel({...record,email},'whatsapp',sendWhatsApp,recipients.phones);const attempts=Number(record.attempts||0)+1;const complete=channelDone(email)&&channelDone(whatsapp);const anyDelivered=email.status==='DELIVERED'||whatsapp.status==='DELIVERED';const permanentSkip=complete&&!anyDelivered;const exhausted=attempts>=Number(record.maxAttempts||5);let status,nextAttemptAt=null;if(complete)status=permanentSkip?'SKIPPED':'DELIVERED';else if(exhausted)status='DEAD';else{status='RETRY_PENDING';nextAttemptAt=new Date(Date.now()+retryMs[Math.min(attempts-1,retryMs.length-1)]).toISOString();}return save({...record,email,whatsapp,attempts,status,nextAttemptAt});
}
export async function listExternalAlerts(limit=200){const {blobs}=await store().list({prefix:'alert/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(Number(limit)||200,500)));const rows=[];for(const blob of selected){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;}
export async function processDueExternalAlerts(limit=25){const rows=await listExternalAlerts(500),current=Date.now(),due=rows.filter(r=>['PENDING','RETRY_PENDING'].includes(r.status)&&(!r.nextAttemptAt||new Date(r.nextAttemptAt).getTime()<=current)).slice(0,Math.max(1,Math.min(Number(limit)||25,50)));const results=[];for(const row of due){try{results.push(await processExternalAlert(row));}catch(error){results.push(await save({...row,status:'RETRY_PENDING',attempts:Number(row.attempts||0)+1,lastError:String(error?.message||error).slice(0,500),nextAttemptAt:new Date(Date.now()+60_000).toISOString()}));}}return results;}
export async function queueTestAdminAlert(){const c=config();if(!c.anyConfigured)throw new Error('Email dan WhatsApp eksternal belum dikonfigurasi.');return queueExternalAlert({notificationId:null,audience:'admin',type:'SYSTEM_TEST',severity:'WARNING',title:'Test kanal alert Libra',message:'Ini adalah test email/WhatsApp dari Admin Libra. Jika pesan ini diterima, kanal eksternal berfungsi.',partnerId:null,reference:`TEST-${Date.now()}`,link:null,metadata:null},{force:true});}
