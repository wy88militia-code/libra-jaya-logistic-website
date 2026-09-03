import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking } from './_booking-core.mjs';

const STORE='libra-courier-custody';
function store(){return getStore(STORE);}
function clean(v,max=160){return String(v??'').trim().slice(0,max);}
function user(v){return clean(v,80).toLowerCase();}
function now(){return new Date().toISOString();}
function hash(v){return crypto.createHash('sha256').update(v).digest('hex');}
function stableHash(event){const copy={...event};delete copy.eventHash;return hash(JSON.stringify(copy));}
function configuredUsers(){try{const rows=JSON.parse(process.env.ADMIN_USERS_JSON||'[]');return (Array.isArray(rows)?rows:[]).filter(r=>r&&r.active!==false&&r.username).map(r=>({username:user(r.username),name:clean(r.name||r.fullName||r.username,120),role:String(r.role||'').toUpperCase()}));}catch{return [];}}
function configuredUser(username,roles=[]){const target=user(username);return configuredUsers().find(r=>r.username===target&&(!roles.length||roles.includes(r.role)))||null;}
function scanCandidates(booking){return [booking?.bookingId,booking?.partnerReference,booking?.awb,booking?.trackingNumber].map(v=>String(v||'').toUpperCase().replace(/\s+/g,'')).filter(Boolean);}
function verifyScan(booking,scanCode){const normalized=String(scanCode||'').toUpperCase().replace(/\s+/g,'');if(!normalized)throw new Error('Scan AWB / QR wajib untuk Chain of Custody.');if(!scanCandidates(booking).includes(normalized))throw new Error('Scan AWB / QR tidak cocok dengan shipment.');return {scanHash:hash(normalized),scanLast4:normalized.slice(-4)};}
function validateGps(latitude,longitude,accuracyMeters){const lat=Number(latitude),lon=Number(longitude),accuracy=Number(accuracyMeters);if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180)throw new Error('Koordinat GPS tidak valid.');if(!Number.isFinite(accuracy)||accuracy<=0||accuracy>200)throw new Error('Chain of Custody wajib GPS dengan akurasi 200 meter atau lebih baik.');return {lat,lon,accuracy};}

export function listConfiguredCouriers(){return configuredUsers().filter(r=>r.role==='COURIER').map(({username,name})=>({username,name})).sort((a,b)=>a.username.localeCompare(b.username));}
export function listConfiguredCustodyUsers(){return configuredUsers().filter(r=>['COURIER','OPS','SUPERADMIN'].includes(r.role)).map(({username,name,role})=>({username,name,role})).sort((a,b)=>a.username.localeCompare(b.username));}

export async function getAssignment(bookingId){return store().get(`assignment/${clean(bookingId,120)}`,{type:'json',consistency:'strong'});}
export async function listAssignments(limit=500){const {blobs}=await store().list({prefix:'assignment/'});const rows=[];for(const blob of blobs.slice(0,Math.max(1,Math.min(limit,2000)))){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows.sort((a,b)=>String(b.updatedAt||b.assignedAt).localeCompare(String(a.updatedAt||a.assignedAt)));}
export async function listAssignmentsForCourier(username,limit=300){const target=user(username);const rows=await listAssignments(Math.max(limit,500));return rows.filter(r=>r.status!=='COMPLETED'&&(user(r.courierUsername)===target||user(r.currentCustodian)===target||user(r.pendingHandoverTo)===target)).slice(0,limit);}

async function appendEvent(input={}){
  const bookingId=clean(input.bookingId,120);const booking=await getBooking(bookingId);if(!booking)throw new Error('Booking tidak ditemukan.');
  const previous=await store().get(`head/${bookingId}`,{type:'json',consistency:'strong'});const createdAt=now();
  const event={eventId:`CUST-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,bookingId,partnerId:booking.partnerId||null,type:clean(input.type,40).toUpperCase(),fromUser:user(input.fromUser)||null,toUser:user(input.toUser)||null,actorUser:user(input.actorUser)||null,actorRole:clean(input.actorRole,40).toUpperCase()||null,locationName:clean(input.locationName,160)||null,condition:clean(input.condition,120)||null,note:clean(input.note,800)||null,latitude:Number.isFinite(Number(input.latitude))?Number(input.latitude):null,longitude:Number.isFinite(Number(input.longitude))?Number(input.longitude):null,accuracyMeters:Number.isFinite(Number(input.accuracyMeters))?Number(input.accuracyMeters):null,scanHash:input.scanHash||null,scanLast4:clean(input.scanLast4,4)||null,previousEventHash:previous?.eventHash||null,createdAt};
  event.eventHash=stableHash(event);await store().setJSON(`event/${bookingId}/${createdAt}-${event.eventId}`,event,{onlyIfNew:true});await store().setJSON(`head/${bookingId}`,{eventId:event.eventId,eventHash:event.eventHash,createdAt});return event;
}

export async function assignCourier({bookingId,courierUsername,actorUser,actorRole,note=''}){
  const id=clean(bookingId,120),courier=user(courierUsername);if(!configuredUser(courier,['COURIER']))throw new Error('Kurir tidak aktif atau tidak terdaftar sebagai role COURIER.');const booking=await getBooking(id);if(!booking)throw new Error('Booking tidak ditemukan.');if(['DELIVERED','PAYMENT_FAILED'].includes(booking.status))throw new Error(`Booking ${booking.status} tidak dapat ditugaskan.`);
  const key=`assignment/${id}`;const existing=await store().get(key,{type:'json',consistency:'strong'});if(existing?.pendingHandoverTo)throw new Error('Reassign diblokir karena masih ada handover yang belum diterima.');if(existing?.currentCustodian&&user(existing.currentCustodian)!==courier)throw new Error(`Barang masih dalam custody ${existing.currentCustodian}. Selesaikan handover sebelum reassign.`);
  const assignedAt=now();const next={assignmentId:existing?.assignmentId||`ASG-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,bookingId:id,partnerId:booking.partnerId||null,courierUsername:courier,status:existing?.currentCustodian?'IN_CUSTODY':'ASSIGNED',assignedAt:existing?.assignedAt||assignedAt,updatedAt:assignedAt,assignedBy:user(actorUser),previousCourierUsername:existing?.courierUsername||null,currentCustodian:existing?.currentCustodian||null,pendingHandoverTo:null,pendingHandoverFrom:null,note:clean(note,500)||null};
  await store().setJSON(key,next);await appendEvent({bookingId:id,type:existing&&user(existing.courierUsername)!==courier?'REASSIGNED':'ASSIGNED',fromUser:existing?.courierUsername,toUser:courier,actorUser,actorRole,note});return next;
}

export async function custodyAction({bookingId,action,actorUser,actorRole,toUser,locationName,condition,note,scanCode,latitude,longitude,accuracyMeters}){
  const id=clean(bookingId,120),actor=user(actorUser),type=clean(action,40).toUpperCase();const assignment=await getAssignment(id);if(!assignment)throw new Error('Shipment belum memiliki assignment kurir.');if(!actor)throw new Error('Identitas petugas tidak tersedia.');
  const isOps=['OPS','SUPERADMIN'].includes(String(actorRole||'').toUpperCase());const pendingRecipient=type==='HANDOVER_IN'&&user(assignment.pendingHandoverTo)===actor;const allowed=isOps||user(assignment.courierUsername)===actor||user(assignment.currentCustodian)===actor||pendingRecipient;if(!allowed)throw new Error('Shipment ini tidak ditugaskan atau diserahkan kepada akun ini.');
  const booking=await getBooking(id);if(!booking)throw new Error('Booking tidak ditemukan.');const gps=validateGps(latitude,longitude,accuracyMeters);const scan=verifyScan(booking,scanCode);if(!clean(locationName,160))throw new Error('Lokasi serah terima wajib diisi.');if(!clean(condition,120))throw new Error('Kondisi barang wajib diisi.');
  let patch={...assignment,updatedAt:now()};let event;const evidence={bookingId:id,actorUser:actor,actorRole,locationName,condition,note,latitude:gps.lat,longitude:gps.lon,accuracyMeters:gps.accuracy,...scan};
  if(type==='TAKE_CUSTODY'){
    if(assignment.pendingHandoverTo)throw new Error('Ada handover pending. Penerima harus memilih Terima Handover.');if(user(assignment.courierUsername)!==actor&&!isOps)throw new Error('Hanya kurir yang ditugaskan yang dapat mengambil custody.');if(assignment.currentCustodian&&user(assignment.currentCustodian)!==actor)throw new Error(`Barang masih tercatat di bawah custody ${assignment.currentCustodian}. Lakukan handover.`);
    patch.currentCustodian=actor;patch.status='IN_CUSTODY';event=await appendEvent({...evidence,type:'CUSTODY_ACCEPTED',toUser:actor});
  }else if(type==='HANDOVER_OUT'){
    const target=user(toUser);if(user(assignment.currentCustodian)!==actor)throw new Error('Hanya custodian aktif yang dapat menyerahkan barang.');if(!target||target===actor)throw new Error('Penerima handover harus akun petugas lain.');if(!configuredUser(target,['COURIER','OPS','SUPERADMIN']))throw new Error('Penerima handover tidak aktif atau tidak memiliki role operasional.');if(assignment.pendingHandoverTo)throw new Error(`Masih ada handover pending ke ${assignment.pendingHandoverTo}.`);
    patch.pendingHandoverTo=target;patch.pendingHandoverFrom=actor;patch.status='HANDOVER_PENDING';event=await appendEvent({...evidence,type:'HANDOVER_OUT',fromUser:actor,toUser:target});
  }else if(type==='HANDOVER_IN'){
    if(!assignment.pendingHandoverTo||user(assignment.pendingHandoverTo)!==actor)throw new Error('Tidak ada handover pending untuk akun ini.');if(user(assignment.pendingHandoverFrom)!==user(assignment.currentCustodian))throw new Error('Custody berubah sejak handover dibuat. Hubungi OPS.');
    patch.currentCustodian=actor;patch.courierUsername=configuredUser(actor,['COURIER'])?actor:assignment.courierUsername;patch.pendingHandoverTo=null;patch.pendingHandoverFrom=null;patch.status='IN_CUSTODY';event=await appendEvent({...evidence,type:'HANDOVER_IN',fromUser:assignment.pendingHandoverFrom,toUser:actor});
  }else if(type==='RELEASE_AT_HUB'){
    if(user(assignment.currentCustodian)!==actor)throw new Error('Hanya custodian aktif yang dapat release barang.');if(assignment.pendingHandoverTo)throw new Error('Selesaikan handover pending sebelum release di hub.');patch.currentCustodian=null;patch.status='AT_HUB';event=await appendEvent({...evidence,type:'RELEASE_AT_HUB',fromUser:actor});
  }else throw new Error('Aksi custody tidak valid.');
  await store().setJSON(`assignment/${id}`,patch);return {assignment:patch,event};
}

export async function completeAssignment(bookingId,{actorUser,actorRole,locationName,condition,note,scanCode,latitude,longitude,accuracyMeters}={}){const id=clean(bookingId,120),current=await getAssignment(id);if(!current)return null;const actor=user(actorUser);if(current.pendingHandoverTo)throw new Error('Assignment tidak dapat ditutup saat handover masih pending.');if(actor&&user(current.currentCustodian)!==actor)throw new Error('Hanya custodian aktif yang dapat menutup assignment saat DELIVERED.');const booking=await getBooking(id);const gps=validateGps(latitude,longitude,accuracyMeters);const scan=verifyScan(booking,scanCode);const next={...current,status:'COMPLETED',currentCustodian:null,pendingHandoverTo:null,pendingHandoverFrom:null,completedAt:now(),updatedAt:now()};await appendEvent({bookingId:id,type:'CUSTODY_CLOSED_DELIVERED',fromUser:actor||current.currentCustodian,actorUser:actor,actorRole,locationName,condition,note,latitude:gps.lat,longitude:gps.lon,accuracyMeters:gps.accuracy,...scan});await store().setJSON(`assignment/${id}`,next);return next;}
export async function listCustodyEvents(bookingId,limit=100){const id=clean(bookingId,120);const {blobs}=await store().list({prefix:`event/${id}/`});const rows=[];for(const blob of blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-Math.max(1,Math.min(limit,300)))){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;}
export async function verifyCustodyChain(bookingId){const rows=await listCustodyEvents(bookingId,300);let previous=null;for(const row of rows){if((row.previousEventHash||null)!==previous)return {ok:false,eventId:row.eventId,reason:'PREVIOUS_HASH_MISMATCH'};if(stableHash(row)!==row.eventHash)return {ok:false,eventId:row.eventId,reason:'EVENT_HASH_MISMATCH'};previous=row.eventHash;}return {ok:true,count:rows.length,headHash:previous};}
