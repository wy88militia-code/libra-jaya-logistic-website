import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { cleanParty, getBooking, newBookingId, reserveIdempotency, saveBooking } from './_booking-core.mjs';
import { getMasterSnapshot } from './_master-sheet-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { getPartner, normalizePartnerId } from './_partner-core.mjs';
import { assertDjjLastmileRoute, djjLastmileMetadata } from './_djj-lastmile-engine.mjs';

const AUDIT_STORE='libra-soetta-booking-audit';
const auditStore=()=>getStore(AUDIT_STORE);
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const now=()=>new Date().toISOString();
const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const kg=v=>Math.round(Number(v||0)*100)/100;
const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');

export const SOETTA_SERVICE_TYPES=Object.freeze({
  DTP:Object.freeze({code:'DTP',label:'Door to Port',requiresPickup:true,requiresLastmile:false}),
  PTP:Object.freeze({code:'PTP',label:'Port to Port',requiresPickup:false,requiresLastmile:false}),
  PTD:Object.freeze({code:'PTD',label:'Port to Door / Last-mile',requiresPickup:false,requiresLastmile:true}),
  DTD:Object.freeze({code:'DTD',label:'Door to Door',requiresPickup:true,requiresLastmile:true}),
});
export const SOETTA_SERVICE_LEVELS=Object.freeze({
  REGULAR:Object.freeze({code:'REGULAR',label:'Reguler',customerMinimumChargeKg:0}),
  ONS:Object.freeze({code:'ONS',label:'ONS',customerMinimumChargeKg:10}),
});

export function resolveSoettaServiceType(value){return SOETTA_SERVICE_TYPES[upper(value)]||null;}
export function resolveSoettaServiceLevel(value){return SOETTA_SERVICE_LEVELS[upper(value)]||null;}
function hubCode(value){const v=upper(value);if(v.includes('WMX')||v.includes('WAMENA'))return 'WMX';if(v.includes('OKS')||v.includes('OKSIBIL'))return 'OKS';if(v.includes('DEX')||v.includes('DEKAI'))return 'DEX';if(v.includes('DJJ')||v.includes('SENTANI')||v.includes('DORTHEYS')||v.includes('JAYAPURA'))return 'DJJ';return v.replace(/[^A-Z0-9]/g,'').slice(0,12)||'DJJ';}

function coord(input,prefix='destination'){
  const latitude=finite(input?.[`${prefix}Latitude`]),longitude=finite(input?.[`${prefix}Longitude`]),accuracy=finite(input?.[`${prefix}AccuracyMeters`]);
  if(latitude===null&&longitude===null&&accuracy===null)return null;
  if(latitude===null||latitude<-90||latitude>90||longitude===null||longitude<-180||longitude>180)throw new Error(`Koordinat ${prefix} tidak valid.`);
  if(accuracy===null||accuracy<=0||accuracy>200)throw new Error(`Akurasi GPS ${prefix} harus 200 meter atau lebih baik.`);
  return {latitude,longitude,accuracyMeters:accuracy};
}
async function activeRoute(kodeRute){
  const snapshot=await getMasterSnapshot();if(!snapshot)throw new Error('Master rute belum dipublish.');
  const route=(snapshot.routes||[]).find(r=>String(r.kodeRute||'')===String(kodeRute||''));if(!route)throw new Error('Rute tujuan tidak ditemukan pada Master.');
  if(String(route.coverageStatus||'').toUpperCase()!=='ACTIVE')throw new Error(`Rute ${route.kodeRute} belum ACTIVE: ${route.coverageReason||route.coverageStatus||'review operasional'}.`);
  assertDjjLastmileRoute(route);
  return {route,snapshot};
}
async function appendAudit(booking,actor='ops'){
  const store=auditStore(),headKey=`head/${booking.bookingId}`,head=await store.get(headKey,{type:'json',consistency:'strong'}),createdAt=now();
  const event={eventId:`SOB-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,bookingId:booking.bookingId,type:'SOETTA_BOOKING_CREATED',actor:clean(actor,100),source:booking.source,partnerId:booking.partnerId||null,serviceType:booking.serviceType,serviceLevel:booking.serviceLevel,lastmileEngineId:booking.lastmileEngine?.id||null,weightKg:booking.weightKg,packageCount:booking.packageCount,pricingStatus:booking.pricingStatus,previousEventHash:head?.eventHash||null,createdAt};
  event.eventHash=sha(JSON.stringify(event));await store.setJSON(`event/${booking.bookingId}/${createdAt}-${event.eventId}`,event,{onlyIfNew:true});await store.setJSON(headKey,{eventId:event.eventId,eventHash:event.eventHash,createdAt});return event;
}

export async function createSoettaAdminBooking(input={},session={}){
  const requestToken=clean(input.requestToken,120);if(requestToken.length<8)throw new Error('Request token booking tidak valid. Refresh form lalu ulangi.');
  const type=resolveSoettaServiceType(input.serviceType),level=resolveSoettaServiceLevel(input.serviceLevel);if(!type||!level)throw new Error('Pilihan layanan tidak valid.');
  const weightKg=kg(input.weightKg),packageCount=Math.trunc(Number(input.packageCount||1));if(!(weightKg>0&&weightKg<=100000))throw new Error('Berat booking tidak valid.');if(!Number.isInteger(packageCount)||packageCount<1||packageCount>10000)throw new Error('Jumlah koli tidak valid.');
  const sender=cleanParty({name:input.senderName,phone:input.senderPhone,address:input.senderAddress,reference:input.senderReference}),recipient=cleanParty({name:input.recipientName,phone:input.recipientPhone,address:input.recipientAddress,reference:input.recipientReference});
  if(!sender.name||!sender.phone)throw new Error('Nama dan HP pengirim wajib diisi.');if(!recipient.name||!recipient.phone)throw new Error('Nama dan HP penerima wajib diisi.');if(type.requiresPickup&&!sender.address)throw new Error('Layanan Door wajib alamat pickup/pengirim.');if(type.requiresLastmile&&!recipient.address)throw new Error('Layanan ke Door wajib alamat lengkap penerima.');
  const customerMode=upper(input.customerMode||'DIRECT');let partnerId=normalizePartnerId(input.partnerId);if(customerMode==='PARTNER'&&!partnerId)throw new Error('Pilih partner aktif untuk booking Partner Libra.');if(customerMode!=='PARTNER')partnerId='';
  let partner=null;if(partnerId){partner=await getPartner(partnerId);if(!partner||partner.status!=='ACTIVE')throw new Error('Partner tidak ditemukan atau belum ACTIVE.');}
  let route=null,snapshot=null,destination=null,destinationHub='DJJ',viaHub=null;
  if(type.requiresLastmile){
    ({route,snapshot}=await activeRoute(input.kodeRute));const point=coord(input,'destination');if(!point)throw new Error('Layanan ke Door wajib titik GPS tujuan penerima.');destinationHub='DJJ';viaHub=null;
    destination={kodeWilayah:route.kodeWilayah||null,kelurahan:route.kelurahan||null,distrik:route.distrik||null,kabupatenKota:route.kabupatenKota||null,provinsi:route.provinsi||null,...point,confirmedKelurahan:true,coordinateSource:'ADMIN_CUSTOMER_LOCATION'};
  }else{
    const destinationCode=hubCode(input.destinationPortCode||'DJJ');if(destinationCode!=='DJJ')throw new Error('Pilot Port dari Soetta saat ini dikunci ke DJJ. Rute lain aktif setelah master airline/service dipublish.');destinationHub='DJJ';destination={kodeWilayah:null,kelurahan:'PORT DJJ / BANDARA SENTANI',distrik:'SENTANI',kabupatenKota:'KABUPATEN JAYAPURA',provinsi:'PAPUA',confirmedKelurahan:false,portDelivery:true};
  }
  const pickupPoint=coord(input,'pickup');const pickup=type.requiresPickup?{address:sender.address,...(pickupPoint||{}),gpsRequiredBeforeAssignment:!pickupPoint}:null;
  const idempotencyOwner=partnerId||'JLX_SOETTA_COUNTER',proposedId=newBookingId(),reservation=await reserveIdempotency(idempotencyOwner,requestToken,proposedId);if(!reservation.created){const existing=await getBooking(reservation.bookingId);if(existing)return {booking:existing,duplicate:true};throw new Error('Request booking sedang diproses. Refresh lalu cek antrean.');}
  const createdAt=now(),booking={
    bookingId:proposedId,partnerId:partnerId||null,customerType:partnerId?'PARTNER':'COUNTER_DIRECT',status:'BOOKED',source:'JLX_SOETTA_ADMIN',idempotencyKey:requestToken,
    partnerReference:clean(input.partnerReference,120),sender,recipient,destination,pickup,originHub:'CGK',viaHub,destinationHub,
    kodeRute:route?.kodeRute||`CGK-${destinationHub}`,kodeWilayah:route?.kodeWilayah||null,service:`${type.code}_${level.code}`,serviceType:type.code,serviceTypeLabel:type.label,serviceLevel:level.code,serviceLevelLabel:level.label,
    requiresPickup:type.requiresPickup,requiresLastmile:type.requiresLastmile,lastmileEngine:type.requiresLastmile?djjLastmileMetadata('JLX_INTERNAL'):null,
    weightKg,chargeableWeightKg:null,packageCount,cargoType:upper(input.cargoType||'GENERAL').slice(0,40)||'GENERAL',commodity:clean(input.commodity,160)||null,
    amount:null,currency:'IDR',pricingStatus:'PENDING_FINAL_WEIGHT',billingStatus:'PENDING_FINAL_WEIGHT',paymentStatus:'NOT_POSTED',walletDebited:false,financeAutoPost:false,
    customerMinimumChargeKg:level.customerMinimumChargeKg,sla:route?.slaTotalHub||route?.slaLastmile||route?.slaMaster||null,masterVersion:snapshot?.version||null,
    operationalNote:clean(input.operationalNote,500)||null,bookedAt:createdAt,createdAt,updatedAt:createdAt,createdByAdmin:clean(session.username||'ops',100),createdByRole:upper(session.role||'OPS'),
    financeGate:{status:'PENDING_FINAL_WEIGHT',autoPost:false,reason:'SOETTA_ADMIN_BOOKING_WAIT_FINAL_WEIGHT_AND_PRICING'},
  };
  const saved=await saveBooking(booking,{onlyIfNew:true});if(!saved.modified)throw new Error('Booking ID sudah ada. Ulangi proses.');await appendAudit(booking,session.username||'ops');
  if(partnerId)try{await createOperationalNotification({partnerId,type:'BOOKING_CREATED',severity:'INFO',title:'Booking dibuat oleh Admin Soetta',message:`Booking ${booking.bookingId} • ${type.label} • ${level.label} • ${weightKg} kg telah diterima operasional Soetta. Harga final menunggu timbang/final pricing.`,reference:booking.bookingId,partnerLink:'/partner/history.html',adminLink:'/jlx-soetta',dedupeKey:`soetta-admin-booking:${booking.bookingId}`,metadata:{bookingId:booking.bookingId,serviceType:type.code,serviceLevel:level.code,lastmileEngineId:booking.lastmileEngine?.id||null,source:booking.source}});}catch{}
  return {booking,duplicate:false};
}

export async function verifySoettaBookingAudit(bookingId){const store=auditStore(),{blobs}=await store.list({prefix:`event/${clean(bookingId,120)}/`}),rows=[];for(const b of blobs.sort((a,b)=>a.key.localeCompare(b.key))){const r=await store.get(b.key,{type:'json'});if(r)rows.push(r);}let previous=null;for(const row of rows){if((row.previousEventHash||null)!==previous)return {ok:false,count:rows.length,eventId:row.eventId,reason:'PREVIOUS_HASH_MISMATCH'};const copy={...row};delete copy.eventHash;if(sha(JSON.stringify(copy))!==row.eventHash)return {ok:false,count:rows.length,eventId:row.eventId,reason:'EVENT_HASH_MISMATCH'};previous=row.eventHash;}return {ok:true,count:rows.length,headHash:previous};}
