import { createBookingForPartner } from './_booking-service.mjs';
import { requirePartnerSession } from './_partner-core.mjs';

export default async request=>{
  const partner=await requirePartnerSession(request);if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
  if(request.method!=='POST')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
  let body;try{body=await request.json();}catch{return Response.json({message:'Permintaan tidak valid.'},{status:400});}
  const idem=String(request.headers.get('idempotency-key')||body?.idempotencyKey||'').trim();
  try{const result=await createBookingForPartner(partner,body,idem,'PORTAL');return Response.json({ok:true,...result},{status:result.duplicate?200:201});}
  catch(error){if(error?.code==='INSUFFICIENT_BALANCE')return Response.json({ok:false,code:error.code,message:'Saldo deposit tidak cukup. Booking tersimpan menunggu top-up.',bookingId:error.bookingId,balance:error.balance},{status:402});const status=error?.code==='QUOTE_NOT_FOUND'?404:error?.code==='QUOTE_FORBIDDEN'?403:422;return Response.json({ok:false,code:error?.code||'BOOKING_ERROR',message:error?.message||'Booking tidak dapat diproses.',bookingId:error?.bookingId||null},{status});}
};
export const config={path:'/.netlify/functions/partner-booking-create',method:'POST',rateLimit:{windowSize:60,windowLimit:30,aggregateBy:'ip',action:'rate_limit'}};
