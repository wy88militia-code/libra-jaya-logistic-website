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

export function listConfiguredCouriers(){
  try{
    const rows=JSON.parse(process.env.ADMIN_USERS_JSON||'[]');
    return (Array.isArray(rows)?rows:[]).filter(r=>r&&r.active!==false&&String(r.role||'').toUpperCase()==='COURIER').map(r=>({username:clean(r.username,80),name:clean(r.name||r.fullName||r.username,120)})).filter(r=>r.username).sort((a,b)=>a.username.localeCompare(b.username));
  }catch{return [];}
}

export async function getAssignment(bookingId){return store().get(`assignment/${clean(bookingId,120)}`,{type:'json',consistency:'strong'});}
export async function listAssignments(limit=500){const {blobs}=await store().list({prefix:'assignment/'});const rows=[];for(const blob of blobs.slice(0,Math.max(1,Math.min(limit,2000)))){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows.sort((a,b)=>String(b.updatedAt||b.assignedAt).localeCompare(String(a.updatedAt||a.assignedAt)));}
export async function listAssignmentsForCourier(username,limit=300){const target=user(username);const rows=await listAssignments(Math.max(limit,500));return rows.filter(r=>user(r.courierUsername)===target&&r.status!=='COMPLETED').slice(0,limit);}

async function appendEvent(input={}){
  const bookingId=clean(input.bookingId,120);const booking=await getBooking(bookingId);if(!booking)throw new Error('Booking tidak ditemukan.');
  const previous=await store().get(`head/${bookingId}`,{type:'json',consistency:'strong'});const createdAt=now();
  const event={eventId:`CUST-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,bookingId,partnerId:booking.partnerId||null,type:clean(input.type,40).toUpperCase(),fromUser:user(input.fromUser)||null,toUser:user(input.toUser)||null,actorUser:user(input.actorUser)||null,actorRole:clean(input.actorRole,40).toUpperCase()||null,locationName:clean(input.locationName,160)||null,condition:clean(input.condition,120)||null,note:clean(input.note,800)||null,latitude:Number.isFinite(Number(input.latitude))?Number(input.latitude):null,longitude:Number.isFinite(Number(input.longitude))?Number(input.longitude):null,accuracyMeters:Number.isFinite(Number(input.accuracyMeters))?Number(input.accuracyMeters):null,previousEventHash:previous?.eventHash||null,createdAt};
  event.eventHash=stableHash(event);await store().setJSON(`event/${bookingId}/${createdAt}-${event.eventId}`,event,{onlyIfNew:true});await store().setJSON(`head/${bookingId}`,{eventId:event.eventId,eventHash:event.eventHash,createdAt});return event;
}

export async function assignCourier({bookingId,courierUsername,actorUser,actorRole,note=''}){
  const id=clean(bookingId,120),courier=user(courierUsername);if(!courier)throw new Error('Username kurir wajib diisi.');const booking=await getBooking(id);if(!booking)throw new Error('Booking tidak ditemukan.');if(['DELIVERED','PAYMENT_FAILED'].includes(booking.status))throw new Error(`Booking ${booking.status} tidak dapat ditugaskan.`);
  const key=`assignment/${id}`;const existing=await store().get(key,{type:'json',consistency:'strong'});const assignedAt=now();const next={assignmentId:existing?.assignmentId||`ASG-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,bookingId:id,partnerId:booking.partnerId||null,courierUsername:courier,status:'ASSIGNED',assignedAt:existing?.assignedAt||assignedAt,updatedAt:assignedAt,assignedBy:user(actorUser),previousCourierUsername:existing?.courierUsername||null,currentCustodian:existing?.currentCustodian||null,note:clean(note,500)||null};
  await store().setJSON(key,next);await appendEvent({bookingId:id,type:existing&&user(existing.courierUsername)!==courier?'REASSIGNED':'ASSIGNED',fromUser:existing?.courierUsername,toUser:courier,actorUser,actorRole,note});return next;
}

export async function custodyAction({bookingId,action,actorUser,actorRole,toUser,locationName,condition,note,latitude,longitude,accuracyMeters}){
  const id=clean(bookingId,120),actor=user(actorUser),type=clean(action,40).toUpperCase();const assignment=await getAssignment(id);if(!assignment)throw new Error('Shipment belum memiliki assignment kurir.');if(!actor)throw new Error('Identitas kurir tidak tersedia.');
  const isOps=['OPS','SUPERADMIN'].includes(String(actorRole||'').toUpperCase());if(!isOps&&user(assignment.courierUsername)!==actor&&user(assignment.currentCustodian)!==actor)throw new Error('Shipment ini tidak ditugaskan kepada akun kurir ini.');
  const accuracy=Number(accuracyMeters);if(!Number.isFinite(accuracy)||accuracy<=0||accuracy>200)throw new Error('Chain of Custody wajib GPS dengan akurasi 200 meter atau lebih baik.');if(!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude)))throw new Error('Koordinat GPS tidak valid.');if(!clean(condition,120))throw new Error('Kondisi barang wajib diisi.');
  let patch={...assignment,updatedAt:now()};let event;
  if(type==='TAKE_CUSTODY'){
    if(assignment.currentCustodian&&user(assignment.currentCustodian)!==actor)throw new Error(`Barang masih tercatat di bawah custody ${assignment.currentCustodian}. Lakukan handover.`);
    patch.currentCustodian=actor;patch.status='IN_CUSTODY';event=await appendEvent({bookingId:id,type:'CUSTODY_ACCEPTED',toUser:actor,actorUser:actor,actorRole,locationName,condition,note,latitude,longitude,accuracyMeters});
  }else if(type==='HANDOVER_OUT'){
    const target=user(toUser);if(!target)throw new Error('Username penerima handover wajib diisi.');if(!isOps&&user(assignment.currentCustodian)!==actor)throw new Error('Hanya custodian aktif yang dapat menyerahkan barang.');patch.pendingHandoverTo=target;patch.pendingHandoverFrom=actor;patch.status='HANDOVER_PENDING';event=await appendEvent({bookingId:id,type:'HANDOVER_OUT',fromUser:actor,toUser:target,actorUser:actor,actorRole,locationName,condition,note,latitude,longitude,accuracyMeters});
  }else if(type==='HANDOVER_IN'){
    if(!assignment.pendingHandoverTo||user(assignment.pendingHandoverTo)!==actor)throw new Error('Tidak ada handover pending untuk akun ini.');patch.currentCustodian=actor;patch.courierUsername=actor;patch.pendingHandoverTo=null;patch.pendingHandoverFrom=null;patch.status='IN_CUSTODY';event=await appendEvent({bookingId:id,type:'HANDOVER_IN',fromUser:assignment.pendingHandoverFrom,toUser:actor,actorUser:actor,actorRole,locationName,condition,note,latitude,longitude,accuracyMeters});
  }else if(type==='RELEASE_AT_HUB'){
    if(!isOps&&user(assignment.currentCustodian)!==actor)throw new Error('Hanya custodian aktif yang dapat release barang.');patch.currentCustodian=null;patch.status='AT_HUB';event=await appendEvent({bookingId:id,type:'RELEASE_AT_HUB',fromUser:actor,actorUser:actor,actorRole,locationName,condition,note,latitude,longitude,accuracyMeters});
  }else throw new Error('Aksi custody tidak valid.');
  await store().setJSON(`assignment/${id}`,patch);return {assignment:patch,event};
}

export async function completeAssignment(bookingId){const current=await getAssignment(bookingId);if(!current)return null;const next={...current,status:'COMPLETED',currentCustodian:null,pendingHandoverTo:null,pendingHandoverFrom:null,completedAt:now(),updatedAt:now()};await store().setJSON(`assignment/${clean(bookingId,120)}`,next);return next;}
export async function listCustodyEvents(bookingId,limit=100){const id=clean(bookingId,120);const {blobs}=await store().list({prefix:`event/${id}/`});const rows=[];for(const blob of blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-Math.max(1,Math.min(limit,300)))){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;}
export async function verifyCustodyChain(bookingId){const rows=await listCustodyEvents(bookingId,300);let previous=null;for(const row of rows){if((row.previousEventHash||null)!==previous)return {ok:false,eventId:row.eventId,reason:'PREVIOUS_HASH_MISMATCH'};if(stableHash(row)!==row.eventHash)return {ok:false,eventId:row.eventId,reason:'EVENT_HASH_MISMATCH'};previous=row.eventHash;}return {ok:true,count:rows.length,headHash:previous};}
