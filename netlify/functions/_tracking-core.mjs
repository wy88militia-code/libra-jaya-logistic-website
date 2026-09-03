import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking, updateBooking } from './_booking-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { queueTrackingWebhook } from './_partner-webhook.mjs';

const TRACKING_STORE='libra-tracking';
const POD_STORE='libra-pod';
const ALLOWED_STATUSES=new Set(['BOOKED','PICKUP_ASSIGNED','PICKED_UP','AT_ORIGIN_HUB','IN_TRANSIT','CONNECTING_FLIGHT','ARRIVED_DESTINATION','OUT_FOR_DELIVERY','DELIVERED','HELD','DAMAGED','CLAIM_PROCESS']);
const PAYMENT_BLOCKED=new Set(['PAYMENT_PENDING','WAITING_TOPUP','PAYMENT_FAILED']);
function trackingStore(){return getStore(TRACKING_STORE);}
function podStore(){return getStore(POD_STORE);}
function now(){return new Date().toISOString();}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}

export async function savePodFile(file,bookingId){
  if(!file||typeof file.arrayBuffer!=='function'||!file.size)return null;
  const allowed=new Set(['image/jpeg','image/png','image/webp']);if(!allowed.has(file.type))throw new Error('Foto POD harus JPG, PNG, atau WEBP.');if(file.size>5*1024*1024)throw new Error('Foto POD maksimal 5 MB.');
  const podId=`POD-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;const bytes=Buffer.from(await file.arrayBuffer());
  await podStore().setJSON(`pod/${podId}`,{podId,bookingId,contentType:file.type,originalName:String(file.name||'pod').slice(0,120),size:file.size,base64:bytes.toString('base64'),uploadedAt:now()},{onlyIfNew:true});return podId;
}
export async function getPod(podId){return podStore().get(`pod/${String(podId||'').trim()}`,{type:'json',consistency:'strong'});}

export async function addTrackingEvent(input={}){
  const bookingId=String(input.bookingId||'').trim();const booking=await getBooking(bookingId);if(!booking)throw new Error('Booking tidak ditemukan.');
  if(PAYMENT_BLOCKED.has(booking.status))throw new Error(`Booking ${booking.status}; tracking operasional belum boleh dimulai.`);
  const status=String(input.status||'').trim().toUpperCase();if(!ALLOWED_STATUSES.has(status))throw new Error('Status tracking tidak valid.');
  const note=String(input.note||'').trim().slice(0,1000);const receiverName=String(input.receiverName||'').trim().slice(0,120);const podId=String(input.podId||'').trim();
  if(status==='DELIVERED'&&(!receiverName||!podId))throw new Error('Status DELIVERED wajib nama penerima dan foto POD.');
  if(['HELD','DAMAGED','CLAIM_PROCESS'].includes(status)&&!note)throw new Error(`Status ${status} wajib keterangan.`);
  const latitude=finite(input.latitude),longitude=finite(input.longitude),accuracy=finite(input.accuracyMeters);
  if(status==='DELIVERED'&&(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(accuracy)||accuracy<=0||accuracy>200))throw new Error('DELIVERED wajib GPS kurir dengan akurasi 200 meter atau lebih baik.');
  const eventId=`EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;const createdAt=now();
  const event={eventId,bookingId,partnerId:booking.partnerId,status,courierName:String(input.courierName||'').trim().slice(0,120),receiverName:receiverName||null,note:note||null,podId:podId||null,condition:String(input.condition||'').trim().slice(0,120)||null,claimStatus:String(input.claimStatus||'').trim().slice(0,80)||null,claimReference:String(input.claimReference||'').trim().slice(0,120)||null,latitude,longitude,accuracyMeters:accuracy,createdAt};
  const store=trackingStore();await store.setJSON(`event/${bookingId}/${createdAt}-${eventId}`,event,{onlyIfNew:true});await store.setJSON(`latest/${bookingId}`,event);
  const patch={status,currentTrackingStatus:status,lastTrackingAt:createdAt};
  if(status==='DELIVERED'){patch.deliveredAt=createdAt;patch.receiverName=receiverName;patch.podId=podId;patch.deliveryLatitude=latitude;patch.deliveryLongitude=longitude;patch.deliveryAccuracyMeters=accuracy;}
  if(['HELD','DAMAGED','CLAIM_PROCESS'].includes(status)){patch.hasIncident=true;patch.incidentStatus=status;patch.incidentNote=note;patch.claimStatus=event.claimStatus;patch.claimReference=event.claimReference;}
  const updatedBooking=await updateBooking(bookingId,patch);let webhookDispatch=null,webhookQueueError=null,slaEvaluation=null;
  try{webhookDispatch=await queueTrackingWebhook(event,updatedBooking);}catch(error){webhookQueueError=String(error?.message||error).slice(0,300);}
  try{
    if(status==='DELIVERED')await createOperationalNotification({partnerId:booking.partnerId,type:'DELIVERED',severity:'SUCCESS',title:'Kiriman telah diterima',message:`Booking ${bookingId} telah diterima oleh ${receiverName}. POD tersedia di history/tracking.`,reference:bookingId,partnerLink:'/partner/history.html',adminLink:'/admin-courier',dedupeKey:`delivered:${eventId}`,metadata:{bookingId,eventId,podId,receiverName}});
    if(['HELD','DAMAGED','CLAIM_PROCESS'].includes(status))await createOperationalNotification({partnerId:booking.partnerId,type:'INCIDENT',severity:status==='DAMAGED'?'CRITICAL':'WARNING',title:`Insiden kiriman: ${status}`,message:`Booking ${bookingId}: ${note}`,reference:bookingId,partnerLink:'/partner/history.html',adminLink:'/admin-claims',dedupeKey:`incident:${eventId}`,metadata:{bookingId,eventId,status,claimStatus:event.claimStatus,claimReference:event.claimReference}});
    if(webhookQueueError)await createOperationalNotification({partnerId:booking.partnerId,type:'WEBHOOK_QUEUE_ERROR',severity:'CRITICAL',title:'Webhook tracking gagal diantrikan',message:`Event ${status} untuk booking ${bookingId} gagal masuk antrean webhook: ${webhookQueueError}`,reference:bookingId,partnerLink:'/partner/webhook-control',adminLink:'/admin-webhook-control',dedupeKey:`webhook-queue:${eventId}`,metadata:{bookingId,eventId,error:webhookQueueError}});
  }catch{}
  try{const module=await import('./_sla-monitor-core.mjs');slaEvaluation=await module.evaluateBookingSla(updatedBooking,{emitAlerts:true});}catch{}
  return {...event,webhookDispatch,webhookQueueError,slaEvaluation};
}
export async function listTrackingEvents(bookingId,limit=100){const {blobs}=await trackingStore().list({prefix:`event/${bookingId}/`});const selected=blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-Math.max(1,Math.min(limit,300)));const rows=[];for(const blob of selected){const event=await trackingStore().get(blob.key,{type:'json'});if(event)rows.push(event);}return rows;}
export async function listIncidentEvents(limit=200){const {blobs}=await trackingStore().list({prefix:'event/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,1000);const rows=[];for(const blob of selected){const event=await trackingStore().get(blob.key,{type:'json'});if(event&&['HELD','DAMAGED','CLAIM_PROCESS'].includes(event.status))rows.push(event);if(rows.length>=limit)break;}return rows;}
