import { getBooking } from './_booking-core.mjs';
import { requirePartnerSession } from './_partner-core.mjs';
import { listTrackingEvents } from './_tracking-core.mjs';

export default async request=>{
  const partner=await requirePartnerSession(request);if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
  if(request.method!=='GET')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
  const bookingId=String(new URL(request.url).searchParams.get('bookingId')||'').trim();if(!bookingId)return Response.json({message:'Booking ID wajib diisi.'},{status:400});
  const booking=await getBooking(bookingId);if(!booking)return Response.json({message:'Booking tidak ditemukan.'},{status:404});if(booking.partnerId!==partner.partnerId)return Response.json({message:'Booking bukan milik partner ini.'},{status:403});
  const events=await listTrackingEvents(bookingId,150);
  return Response.json({ok:true,booking:{bookingId:booking.bookingId,status:booking.status,partnerReference:booking.partnerReference,weightKg:booking.weightKg,kodeRute:booking.kodeRute,destination:booking.destination,sla:booking.sla,createdAt:booking.createdAt,bookedAt:booking.bookedAt,deliveredAt:booking.deliveredAt,receiverName:booking.receiverName,podUrl:booking.podId?`/.netlify/functions/pod-media?id=${encodeURIComponent(booking.podId)}`:null},events:events.map(e=>({status:e.status,courierName:e.courierName,receiverName:e.receiverName,note:e.note,condition:e.condition,claimStatus:e.claimStatus,claimReference:e.claimReference,createdAt:e.createdAt,podUrl:e.podId?`/.netlify/functions/pod-media?id=${encodeURIComponent(e.podId)}`:null}))},{headers:{'cache-control':'no-store'}});
};
export const config={path:'/.netlify/functions/partner-tracking',method:'GET',rateLimit:{windowSize:60,windowLimit:60,aggregateBy:'ip',action:'rate_limit'}};
