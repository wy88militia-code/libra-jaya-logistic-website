import { getBooking } from './_booking-core.mjs';
import { listTrackingEvents, verifyTrackingChain } from './_tracking-core.mjs';

function clean(value,max=120){return String(value||'').trim().slice(0,max);}
function publicDestination(destination={}){return {kelurahan:destination.kelurahan||null,distrik:destination.distrik||null,kabupaten:destination.kabupaten||null,provinsi:destination.provinsi||null};}

export default async request=>{
  if(request.method!=='GET')return Response.json({ok:false,message:'Method not allowed'},{status:405});
  const bookingId=clean(new URL(request.url).searchParams.get('booking_id'));if(!bookingId)return Response.json({ok:false,message:'Nomor booking/AWB wajib diisi.'},{status:400});
  const booking=await getBooking(bookingId);if(!booking)return Response.json({ok:false,message:'Kiriman tidak ditemukan.'},{status:404});
  const events=await listTrackingEvents(bookingId,100);const integrity=await verifyTrackingChain(bookingId);
  return Response.json({ok:true,shipment:{booking_id:booking.bookingId,status:booking.status,kode_rute:booking.kodeRute||null,destination:publicDestination(booking.destination),sla:booking.sla||null,booked_at:booking.bookedAt||booking.createdAt||null,delivered_at:booking.deliveredAt||null,pod_available:Boolean(booking.podId)},integrity:{ok:integrity.ok,count:integrity.count},events:events.map(e=>({status:e.status,created_at:e.createdAt,note:e.note||null,condition:e.condition||null,scan_verified:Boolean(e.scanVerified),destination_distance_meters:e.status==='DELIVERED'?e.destinationDistanceMeters??null:null}))},{headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
};
export const config={path:'/public-tracking-data',method:'GET',rateLimit:{windowSize:60,windowLimit:30,aggregateBy:'ip',action:'rate_limit'}};
