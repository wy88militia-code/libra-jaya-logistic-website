import { getStore } from '@netlify/blobs';
import { getBooking } from './_booking-core.mjs';

const STORE='libra-smu-registry';
const store=()=>getStore(STORE);
const now=()=>new Date().toISOString();
const clean=(v,n=120)=>String(v??'').trim().slice(0,n);
export const INCOMING_HANDLING_PER_SMU=25000;
export function normalizeSmuNumber(v){return clean(v,80).toUpperCase().replace(/[^A-Z0-9./_-]/g,'');}
export async function getBookingSmu(bookingId){const id=clean(bookingId,120);return id?store().get(`booking/${id}`,{type:'json',consistency:'strong'}):null;}
export async function setBookingSmu(bookingId,smuNumber,actor='admin'){
  const id=clean(bookingId,120),smu=normalizeSmuNumber(smuNumber);if(!id)throw new Error('Booking ID wajib.');const booking=await getBooking(id);if(!booking)throw new Error('Booking tidak ditemukan.');
  if(!smu){await store().delete(`booking/${id}`).catch(()=>{});return {bookingId:id,smuNumber:null,removed:true};}
  const t=now(),row={bookingId:id,partnerId:booking.partnerId||null,kodeRute:booking.kodeRute||null,smuNumber:smu,updatedAt:t,updatedBy:clean(actor,100)};await store().setJSON(`booking/${id}`,row);return row;
}
export async function listBookingSmuAssignments(limit=2000){const {blobs}=await store().list({prefix:'booking/'}),rows=[];for(const b of blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.min(Math.max(1,Number(limit)||2000),3000))){const row=await store().get(b.key,{type:'json'});if(row)rows.push(row);}return rows;}
export async function bookingSmuMap(){return new Map((await listBookingSmuAssignments(3000)).map(r=>[r.bookingId,r]));}
