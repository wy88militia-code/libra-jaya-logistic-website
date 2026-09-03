import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME='libra-notifications';
const store=()=>getStore(STORE_NAME);
const now=()=>new Date().toISOString();
const normalizePartnerId=value=>String(value??'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,40);
const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const notificationId=()=>`NTF-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const dedupeHash=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');

async function createForAudience(audience,input={}){
  const dedupeKey=clean(input.dedupeKey,300);
  if(dedupeKey){
    const marker=`dedupe/${audience}/${dedupeHash(dedupeKey)}`;
    const claimed=await store().set(marker,'1',{onlyIfNew:true});
    if(!claimed.modified)return null;
  }
  const id=notificationId();const createdAt=now();
  const record={notificationId:id,audience,type:clean(input.type,80)||'INFO',severity:['INFO','WARNING','CRITICAL','SUCCESS'].includes(String(input.severity||'').toUpperCase())?String(input.severity).toUpperCase():'INFO',title:clean(input.title,160),message:clean(input.message,1200),partnerId:normalizePartnerId(input.partnerId)||null,reference:clean(input.reference,160)||null,link:clean(input.link,300)||null,metadata:input.metadata&&typeof input.metadata==='object'?input.metadata:null,readAt:null,createdAt,updatedAt:createdAt};
  await store().setJSON(`${audience}/${id}`,record,{onlyIfNew:true});return record;
}

export async function createOperationalNotification(input={}){
  const id=normalizePartnerId(input.partnerId);const rows=[];
  if(input.notifyPartner!==false&&id){const row=await createForAudience(`partner/${id}`,{...input,partnerId:id,link:input.partnerLink||input.link||null,dedupeKey:input.dedupeKey?`partner:${id}:${input.dedupeKey}`:''});if(row)rows.push(row);}
  if(input.notifyAdmin!==false){const row=await createForAudience('admin',{...input,partnerId:id,link:input.adminLink||input.link||null,dedupeKey:input.dedupeKey?`admin:${input.dedupeKey}`:''});if(row)rows.push(row);}
  return rows;
}

async function listAudience(audience,limit=50){
  const {blobs}=await store().list({prefix:`${audience}/`});const selected=blobs.filter(b=>b.key.includes('/NTF-')).sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(Number(limit)||50,200)));const rows=[];
  for(const blob of selected){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;
}
export async function listPartnerNotifications(partnerId,limit=50){const id=normalizePartnerId(partnerId);return id?listAudience(`partner/${id}`,limit):[];}
export async function listAdminNotifications(limit=100){return listAudience('admin',limit);}
export async function countUnreadPartnerNotifications(partnerId){return (await listPartnerNotifications(partnerId,200)).filter(row=>!row.readAt).length;}
export async function countUnreadAdminNotifications(){return (await listAdminNotifications(200)).filter(row=>!row.readAt).length;}

async function markRead(audience,id){const key=`${audience}/${clean(id,80)}`;const row=await store().get(key,{type:'json',consistency:'strong'});if(!row)return null;if(row.readAt)return row;const stamp=now();const next={...row,readAt:stamp,updatedAt:stamp};await store().setJSON(key,next);return next;}
async function markAllRead(audience){const rows=await listAudience(audience,200);const stamp=now();let count=0;for(const row of rows){if(row.readAt)continue;await store().setJSON(`${audience}/${row.notificationId}`,{...row,readAt:stamp,updatedAt:stamp});count+=1;}return count;}
export async function markPartnerNotificationRead(partnerId,id){const pid=normalizePartnerId(partnerId);return pid?markRead(`partner/${pid}`,id):null;}
export async function markAllPartnerNotificationsRead(partnerId){const pid=normalizePartnerId(partnerId);return pid?markAllRead(`partner/${pid}`):0;}
export async function markAdminNotificationRead(id){return markRead('admin',id);}
export async function markAllAdminNotificationsRead(){return markAllRead('admin');}
