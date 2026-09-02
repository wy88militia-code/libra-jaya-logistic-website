import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME='libra-bookings';
function store(){return getStore(STORE_NAME);}
function bookingKey(id){return `booking/${String(id||'').trim()}`;}
function idempotencyKey(partnerId,key){return `idempotency/${partnerId}/${String(key||'').trim().slice(0,120)}`;}
function now(){return new Date().toISOString();}
export function newBookingId(){return `LBRB-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;}
export async function getBooking(id){return store().get(bookingKey(id),{type:'json',consistency:'strong'});}
export async function getBookingWithMetadata(id){return store().getWithMetadata(bookingKey(id),{type:'json',consistency:'strong'});}
export async function saveBooking(booking,options={}){return store().setJSON(bookingKey(booking.bookingId),booking,options);}
export async function updateBooking(bookingId,patch={}){const entry=await getBookingWithMetadata(bookingId);if(!entry?.data)throw new Error('Booking tidak ditemukan.');const next={...entry.data,...patch,bookingId:entry.data.bookingId,updatedAt:now()};const result=await saveBooking(next,{onlyIfMatch:entry.etag});if(!result.modified)throw new Error('Booking berubah di proses lain. Refresh lalu coba lagi.');return next;}
export async function listBookings(limit=200){const {blobs}=await store().list({prefix:'booking/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(limit,500)));const rows=[];for(const blob of selected){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
export async function findBookingByIdempotency(partnerId,key){const id=await store().get(idempotencyKey(partnerId,key),{type:'text',consistency:'strong'});return id?getBooking(id):null;}
export async function reserveIdempotency(partnerId,key,bookingId){const clean=String(key||'').trim();if(clean.length<8)throw new Error('Idempotency-Key minimal 8 karakter.');const result=await store().set(idempotencyKey(partnerId,clean),bookingId,{onlyIfNew:true});if(result.modified)return {bookingId,created:true};const existing=await store().get(idempotencyKey(partnerId,clean),{type:'text',consistency:'strong'});return {bookingId:existing,created:false};}
export function cleanParty(input={}){return {name:String(input.name||'').trim().slice(0,120),phone:String(input.phone||'').trim().slice(0,40),address:String(input.address||'').trim().slice(0,500),reference:String(input.reference||'').trim().slice(0,100)};}
export function validateDestination(input={},quote){
  const latitude=Number(input.latitude),longitude=Number(input.longitude),accuracy=Number(input.accuracyMeters);
  if(!input.confirmedKelurahan)throw new Error('Kelurahan tujuan belum dikonfirmasi.');
  if(String(input.kodeWilayah||'')!==String(quote.kodeWilayah||''))throw new Error('Kode wilayah tujuan tidak sama dengan quote.');
  if(!Number.isFinite(latitude)||latitude<-90||latitude>90||!Number.isFinite(longitude)||longitude<-180||longitude>180)throw new Error('Koordinat GPS tujuan tidak valid.');
  if(!Number.isFinite(accuracy)||accuracy<=0||accuracy>200)throw new Error('Akurasi GPS harus 200 meter atau lebih baik.');
  return {kodeWilayah:quote.kodeWilayah,kelurahan:quote.kelurahan,distrik:quote.distrik,kabupatenKota:quote.kabupatenKota,latitude,longitude,accuracyMeters:accuracy,confirmedKelurahan:true};
}
