import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking, updateBooking } from './_booking-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { queueTrackingWebhook } from './_partner-webhook.mjs';
import { bookingSmuReadyForRoute } from './_smu-core.mjs';

const TRACKING_STORE='libra-tracking';
const POD_STORE='libra-pod';
const INCIDENT_MEDIA_STORE='libra-incident-media';
const ALLOWED_STATUSES=new Set(['BOOKED','PICKUP_ASSIGNED','PICKED_UP','AT_ORIGIN_HUB','IN_TRANSIT','CONNECTING_FLIGHT','ARRIVED_DESTINATION','OUT_FOR_DELIVERY','DELIVERED','HELD','DAMAGED','LOST','MIXED_UP','CLAIM_PROCESS']);
const PAYMENT_BLOCKED=new Set(['PAYMENT_PENDING','WAITING_TOPUP','PAYMENT_FAILED']);
const SCAN_REQUIRED=new Set(['PICKED_UP','AT_ORIGIN_HUB','IN_TRANSIT','CONNECTING_FLIGHT','ARRIVED_DESTINATION','OUT_FOR_DELIVERY','DELIVERED']);
const INCIDENTS=new Set(['HELD','DAMAGED','LOST','MIXED_UP','CLAIM_PROCESS']);
const PHOTO_REQUIRED_INCIDENTS=new Set(['HELD','DAMAGED','LOST','MIXED_UP']);
const DELIVERY_GEOFENCE_METERS=Math.max(50,Number(process.env.POD_GEOFENCE_METERS||200));
function trackingStore(){return getStore(TRACKING_STORE);}
function podStore(){return getStore(POD_STORE);}
function incidentStore(){return getStore(INCIDENT_MEDIA_STORE);}
function now(){return new Date().toISOString();}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function clean(value,max=200){return String(value||'').trim().slice(0,max);}
function normalizeScan(value){return clean(value,180).toUpperCase().replace(/\s+/g,'');}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function stableEventHash(event){const copy={...event};delete copy.eventHash;return sha256(JSON.stringify(copy));}
function rad(v){return Number(v)*Math.PI/180;}
function haversineMeters(aLat,aLon,bLat,bLon){const R=6371000;const dLat=rad(bLat-aLat),dLon=rad(bLon-aLon);const x=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));}
function scanMatchesBooking(scanCode,booking){if(!scanCode)return false;const candidates=[booking.bookingId,booking.partnerReference,booking.awb,booking.trackingNumber,...(Array.isArray(booking.smus)?booking.smus.map(s=>s?.smuNumber):[])].filter(Boolean).map(normalizeScan);return candidates.includes(normalizeScan(scanCode));}

async function saveImmutableImage(file,bookingId,prefix,storeRef){
  const id=clean(bookingId,120);const booking=await getBooking(id);if(!booking)throw new Error('Booking tidak ditemukan.');if(!file||typeof file.arrayBuffer!=='function'||!file.size)return null;const allowed=new Set(['image/jpeg','image/png','image/webp']);if(!allowed.has(file.type))throw new Error('Foto harus JPG, PNG, atau WEBP.');if(file.size>5*1024*1024)throw new Error('Foto maksimal 5 MB.');
  const mediaId=`${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;const bytes=Buffer.from(await file.arrayBuffer());const digest=sha256(bytes);await storeRef.setJSON(`media/${mediaId}`,{mediaId,bookingId:id,contentType:file.type,originalName:clean(file.name||prefix.toLowerCase(),120),size:file.size,sha256:digest,base64:bytes.toString('base64'),uploadedAt:now(),immutable:true},{onlyIfNew:true});return mediaId;
}
export async function savePodFile(file,bookingId){
  const id=clean(bookingId,120);const booking=await getBooking(id);if(!booking)throw new Error('Booking tidak ditemukan.');if(booking.status==='DELIVERED'||booking.podId)throw new Error('POD sudah dikunci dan tidak dapat diganti setelah DELIVERED.');const podId=await saveImmutableImage(file,id,'POD',podStore());if(!podId)return null;const media=await podStore().get(`media/${podId}`,{type:'json',consistency:'strong'});await podStore().setJSON(`pod/${podId}`,media,{onlyIfNew:true});return podId;
}
export async function getPod(podId){return podStore().get(`pod/${clean(podId,140)}`,{type:'json',consistency:'strong'});}
export async function saveIncidentFile(file,bookingId){return saveImmutableImage(file,bookingId,'INC',incidentStore());}
export async function getIncidentFile(mediaId){return incidentStore().get(`media/${clean(mediaId,140)}`,{type:'json',consistency:'strong'});}

export async function addTrackingEvent(input={}){
  const bookingId=clean(input.bookingId,120);const booking=await getBooking(bookingId);if(!booking)throw new Error('Booking tidak ditemukan.');
  if(PAYMENT_BLOCKED.has(booking.status))throw new Error(`Booking ${booking.status}; tracking operasional belum boleh dimulai.`);
  if(booking.status==='DELIVERED')throw new Error('Booking sudah DELIVERED. Riwayat tracking dan POD telah dikunci.');
  const status=clean(input.status,60).toUpperCase();if(!ALLOWED_STATUSES.has(status))throw new Error('Status tracking tidak valid.');
  const note=clean(input.note,1000),receiverName=clean(input.receiverName,120),podId=clean(input.podId,140),scanCode=clean(input.scanCode,180),incidentPhotoId=clean(input.incidentPhotoId,140);
  if(SCAN_REQUIRED.has(status)){if(!scanCode)throw new Error(`Status ${status} wajib scan Booking/SMU/AWB.`);if(!scanMatchesBooking(scanCode,booking))throw new Error('Kode yang dipindai tidak cocok dengan Booking ID, referensi partner, atau nomor SMU pada booking.');}
  if(status==='DELIVERED'&&(!receiverName||!podId))throw new Error('Status DELIVERED wajib nama penerima dan foto POD.');
  if(INCIDENTS.has(status)&&!note)throw new Error(`Status ${status} wajib keterangan.`);
  if(PHOTO_REQUIRED_INCIDENTS.has(status)){if(!incidentPhotoId)throw new Error(`Status ${status} wajib foto bukti.`);const media=await getIncidentFile(incidentPhotoId);if(!media||media.bookingId!==bookingId)throw new Error('Foto insiden tidak valid untuk booking ini.');}
  if(status==='IN_TRANSIT'&&Number(booking.smuCount||0)>0){const gate=await bookingSmuReadyForRoute(bookingId);if(!gate.ready)throw new Error('ON ROUTE ditolak: seluruh SMU wajib selesai rekap fisik incoming terlebih dahulu.');}
  const latitude=finite(input.latitude),longitude=finite(input.longitude),accuracy=finite(input.accuracyMeters);let destinationDistanceMeters=null;
  if(status==='DELIVERED'){
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(accuracy)||accuracy<=0||accuracy>200)throw new Error('DELIVERED wajib GPS kurir dengan akurasi 200 meter atau lebih baik.');
    const dLat=finite(booking.destination?.latitude),dLon=finite(booking.destination?.longitude);if(!Number.isFinite(dLat)||!Number.isFinite(dLon))throw new Error('Koordinat tujuan booking belum tersedia; DELIVERED harus direview OPS.');
    destinationDistanceMeters=Math.round(haversineMeters(latitude,longitude,dLat,dLon));if(destinationDistanceMeters>DELIVERY_GEOFENCE_METERS)throw new Error(`Lokasi kurir ${destinationDistanceMeters} m dari titik tujuan. Maksimum ${DELIVERY_GEOFENCE_METERS} m.`);
    const pod=await getPod(podId);if(!pod||pod.bookingId!==bookingId)throw new Error('Foto POD tidak valid untuk booking ini.');
  }
  const previous=await trackingStore().get(`head/${bookingId}`,{type:'json',consistency:'strong'});const eventId=`EVT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;const createdAt=now();
  const event={eventId,bookingId,partnerId:booking.partnerId,status,courierName:clean(input.courierName,120),receiverName:receiverName||null,note:note||null,podId:podId||null,incidentPhotoId:incidentPhotoId||null,condition:clean(input.condition,120)||null,claimStatus:clean(input.claimStatus,80)||null,claimReference:clean(input.claimReference,120)||null,scanCodeMasked:scanCode?`${scanCode.slice(0,6)}…${scanCode.slice(-4)}`:null,scanVerified:Boolean(scanCode),latitude,longitude,accuracyMeters:accuracy,destinationDistanceMeters,geofenceMeters:status==='DELIVERED'?DELIVERY_GEOFENCE_METERS:null,previousEventHash:previous?.eventHash||null,createdAt};
  event.eventHash=stableEventHash(event);
  const store=trackingStore();await store.setJSON(`event/${bookingId}/${createdAt}-${eventId}`,event,{onlyIfNew:true});await store.setJSON(`latest/${bookingId}`,event);await store.setJSON(`head/${bookingId}`,{eventId,eventHash:event.eventHash,createdAt});
  const patch={status,currentTrackingStatus:status,lastTrackingAt:createdAt,lastTrackingEventHash:event.eventHash};if(status==='PICKED_UP')patch.pickedUpAt=createdAt;if(status==='AT_ORIGIN_HUB')patch.incomingAt=createdAt;if(status==='IN_TRANSIT')patch.onRouteAt=createdAt;
  if(status==='DELIVERED'){patch.deliveredAt=createdAt;patch.receiverName=receiverName;patch.podId=podId;patch.deliveryLatitude=latitude;patch.deliveryLongitude=longitude;patch.deliveryAccuracyMeters=accuracy;patch.deliveryDistanceMeters=destinationDistanceMeters;patch.podLocked=true;}
  if(INCIDENTS.has(status)){patch.hasIncident=true;patch.incidentStatus=status;patch.incidentNote=note;patch.incidentPhotoId=incidentPhotoId||booking.incidentPhotoId||null;patch.claimStatus=event.claimStatus;patch.claimReference=event.claimReference;}
  const updatedBooking=await updateBooking(bookingId,patch);let webhookDispatch=null,webhookQueueError=null,slaEvaluation=null;
  try{webhookDispatch=await queueTrackingWebhook(event,updatedBooking);}catch(error){webhookQueueError=String(error?.message||error).slice(0,300);}
  try{
    if(status==='DELIVERED')await createOperationalNotification({partnerId:booking.partnerId,type:'DELIVERED',severity:'SUCCESS',title:'Kiriman telah diterima',message:`Booking ${bookingId} telah diterima oleh ${receiverName}. POD tersedia di history/tracking.`,reference:bookingId,partnerLink:'/partner/history.html',adminLink:'/admin-courier',dedupeKey:`delivered:${eventId}`,metadata:{bookingId,eventId,podId,receiverName,destinationDistanceMeters}});
    if(INCIDENTS.has(status))await createOperationalNotification({partnerId:booking.partnerId,type:'INCIDENT',severity:['DAMAGED','LOST','MIXED_UP'].includes(status)?'CRITICAL':'WARNING',title:`Insiden kiriman: ${status}`,message:`Booking ${bookingId}: ${note}`,reference:bookingId,partnerLink:'/partner/history.html',adminLink:'/admin-claims',dedupeKey:`incident:${eventId}`,metadata:{bookingId,eventId,status,incidentPhotoId:event.incidentPhotoId,claimStatus:event.claimStatus,claimReference:event.claimReference}});
    if(webhookQueueError)await createOperationalNotification({partnerId:booking.partnerId,type:'WEBHOOK_QUEUE_ERROR',severity:'CRITICAL',title:'Webhook tracking gagal diantrikan',message:`Event ${status} untuk booking ${bookingId} gagal masuk antrean webhook: ${webhookQueueError}`,reference:bookingId,partnerLink:'/partner/webhook-control',adminLink:'/admin-webhook-control',dedupeKey:`webhook-queue:${eventId}`,metadata:{bookingId,eventId,error:webhookQueueError}});
  }catch{}
  try{const module=await import('./_sla-monitor-core.mjs');slaEvaluation=await module.evaluateBookingSla(updatedBooking,{emitAlerts:true});}catch{}
  return {...event,webhookDispatch,webhookQueueError,slaEvaluation};
}
export async function listTrackingEvents(bookingId,limit=100){const {blobs}=await trackingStore().list({prefix:`event/${clean(bookingId,120)}/`});const selected=blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-Math.max(1,Math.min(limit,300)));const rows=[];for(const blob of selected){const event=await trackingStore().get(blob.key,{type:'json'});if(event)rows.push(event);}return rows;}
export async function verifyTrackingChain(bookingId){const rows=await listTrackingEvents(bookingId,300);let previous=null;for(const row of rows){if((row.previousEventHash||null)!==previous)return {ok:false,eventId:row.eventId,reason:'PREVIOUS_HASH_MISMATCH'};if(stableEventHash(row)!==row.eventHash)return {ok:false,eventId:row.eventId,reason:'EVENT_HASH_MISMATCH'};previous=row.eventHash;}return {ok:true,count:rows.length,headHash:previous};}
export async function listIncidentEvents(limit=200){const {blobs}=await trackingStore().list({prefix:'event/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,1000);const rows=[];for(const blob of selected){const event=await trackingStore().get(blob.key,{type:'json'});if(event&&INCIDENTS.has(event.status))rows.push(event);if(rows.length>=limit)break;}return rows;}
