import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking } from './_booking-core.mjs';

const STORE='libra-warehouse';
const ALLOWED=new Set(['INBOUND','STORED','HOLD','DAMAGED','OUTBOUND']);
function store(){return getStore(STORE);}
function clean(v,max=180){return String(v??'').trim().slice(0,max);}
function upper(v,max=180){return clean(v,max).toUpperCase();}
function now(){return new Date().toISOString();}
function sha(v){return crypto.createHash('sha256').update(v).digest('hex');}
function key(id){return `shipment/${clean(id,120)}`;}
function normalizeScan(v){return upper(v,160).replace(/\s+/g,'');}
function scanMatches(booking,scan){const s=normalizeScan(scan);if(!s)return false;return [booking.bookingId,booking.partnerReference,booking.awb,booking.trackingNumber].filter(Boolean).map(normalizeScan).includes(s);}
function stableHash(v){const c={...v};delete c.eventHash;return sha(JSON.stringify(c));}
export async function getWarehouseShipment(bookingId){return store().get(key(bookingId),{type:'json',consistency:'strong'});}
export async function getWarehouseShipmentWithMetadata(bookingId){return store().getWithMetadata(key(bookingId),{type:'json',consistency:'strong'});}
export async function listWarehouseShipments(limit=300){const {blobs}=await store().list({prefix:'shipment/'});const rows=[];for(const b of blobs.slice(0,Math.max(1,Math.min(limit,1000)))){const r=await store().get(b.key,{type:'json'});if(r)rows.push(r);}return rows.sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));}
async function appendEvent(row,input={}){const headKey=`head/${row.bookingId}`;const prev=await store().get(headKey,{type:'json',consistency:'strong'});const createdAt=now();const event={eventId:`WHE-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,bookingId:row.bookingId,type:upper(input.type,60),actor:clean(input.actor,100),hub:upper(input.hub,40)||row.hub||null,zone:upper(input.zone,40)||row.zone||null,rack:upper(input.rack,40)||row.rack||null,condition:upper(input.condition,40)||row.condition||null,note:clean(input.note,700)||null,scanHash:input.scanHash||null,scanLast4:input.scanLast4||null,previousEventHash:prev?.eventHash||null,createdAt};event.eventHash=stableHash(event);await store().setJSON(`event/${row.bookingId}/${createdAt}-${event.eventId}`,event,{onlyIfNew:true});await store().setJSON(headKey,{eventId:event.eventId,eventHash:event.eventHash,createdAt});return event;}
async function saveCas(entry,next){const result=await store().setJSON(key(next.bookingId),next,entry?.etag?{onlyIfMatch:entry.etag}:{onlyIfNew:true});if(!result.modified)throw new Error('Data gudang berubah di proses lain. Refresh lalu coba lagi.');return getWarehouseShipment(next.bookingId);}
function scanEvidence(scan){const s=normalizeScan(scan);return {scanHash:sha(s),scanLast4:s.slice(-4)};}
export async function warehouseAction(input={},actor='admin'){
 const bookingId=clean(input.bookingId,120),action=upper(input.action,30),hub=upper(input.hub,40),zone=upper(input.zone,40),rack=upper(input.rack,40),condition=upper(input.condition,40)||'GOOD';
 if(!bookingId)throw new Error('Booking ID wajib.');if(!ALLOWED.has(action))throw new Error('Aksi gudang tidak valid.');
 const booking=await getBooking(bookingId);if(!booking)throw new Error('Booking tidak ditemukan.');if(!scanMatches(booking,input.scanCode))throw new Error('Scan AWB/QR tidak cocok dengan booking.');if(!hub)throw new Error('Hub wajib diisi.');
 const entry=await getWarehouseShipmentWithMetadata(bookingId),current=entry?.data||null;
 if(action==='INBOUND'&&current&&current.status!=='OUTBOUND')throw new Error(`Booking masih berada di gudang dengan status ${current.status}.`);
 if(action!=='INBOUND'&&!current)throw new Error('Barang belum tercatat INBOUND.');
 if(['STORED','HOLD','DAMAGED'].includes(action)&&(!zone||!rack))throw new Error('Zone dan rack wajib untuk penyimpanan/hold/damage.');
 if(action==='OUTBOUND'&&['HOLD','DAMAGED'].includes(current?.status))throw new Error('Barang HOLD/DAMAGED harus direlease ke STORED sebelum OUTBOUND.');
 const at=now(),evidence=scanEvidence(input.scanCode);let next;
 if(action==='INBOUND')next={bookingId,status:'INBOUND',hub,zone:null,rack:null,condition,createdAt:current?.createdAt||at,createdBy:current?.createdBy||clean(actor,100),updatedAt:at,updatedBy:clean(actor,100),lastScanHash:evidence.scanHash,lastScanLast4:evidence.scanLast4};
 else next={...current,status:action,hub,zone:action==='OUTBOUND'?null:zone||current.zone||null,rack:action==='OUTBOUND'?null:rack||current.rack||null,condition,updatedAt:at,updatedBy:clean(actor,100),lastScanHash:evidence.scanHash,lastScanLast4:evidence.scanLast4,outboundAt:action==='OUTBOUND'?at:current.outboundAt||null};
 const saved=await saveCas(entry,next);await appendEvent(saved,{type:action,actor,hub,zone,rack,condition,note:input.note,...evidence});return saved;
}
export async function listWarehouseEvents(bookingId,limit=200){const {blobs}=await store().list({prefix:`event/${clean(bookingId,120)}/`});const rows=[];for(const b of blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-Math.max(1,Math.min(limit,500)))){const r=await store().get(b.key,{type:'json'});if(r)rows.push(r);}return rows;}
export async function verifyWarehouseChain(bookingId){const rows=await listWarehouseEvents(bookingId,500);let previous=null;for(const row of rows){if(row.previousEventHash!==previous)return {ok:false,count:rows.length,reason:'previousEventHash mismatch'};if(stableHash(row)!==row.eventHash)return {ok:false,count:rows.length,reason:'eventHash mismatch'};previous=row.eventHash;}return {ok:true,count:rows.length,head:previous};}
