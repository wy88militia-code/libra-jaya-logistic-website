import { authenticateApiRequest, writeApiLog } from './_api-auth.mjs';
import { createBookingForPartner } from './_booking-service.mjs';

export default async request=>{
  if(request.method!=='POST')return Response.json({message:'Method not allowed'},{status:405});let context;
  try{
    context=await authenticateApiRequest(request);const idem=String(request.headers.get('x-libra-idempotency-key')||'').trim();if(idem.length<8){const e=new Error('x-libra-idempotency-key minimal 8 karakter wajib diisi.');e.code='IDEMPOTENCY_REQUIRED';throw e;}
    const result=await createBookingForPartner(context.partner,context.json||{},idem,'API');await writeApiLog(context,{status:result.duplicate?200:201,action:'BOOKING',reference:result.booking.bookingId});
    return Response.json({ok:true,duplicate:result.duplicate,booking:{booking_id:result.booking.bookingId,status:result.booking.status,partner_reference:result.booking.partnerReference,quote_id:result.booking.quoteId,route_code:result.booking.kodeRute,amount:result.booking.amount,currency:result.booking.currency,sla:result.booking.sla,destination:result.booking.destination,created_at:result.booking.createdAt},wallet_balance:result.balance},{status:result.duplicate?200:201});
  }catch(error){if(context)await writeApiLog(context,{status:error?.code==='INSUFFICIENT_BALANCE'?402:409,action:'BOOKING',reference:error?.bookingId||null,error:error?.code||error?.message});const auth=String(error?.code||'').startsWith('API_');const status=auth?401:error?.code==='INSUFFICIENT_BALANCE'?402:error?.code==='QUOTE_NOT_FOUND'?404:error?.code==='QUOTE_FORBIDDEN'?403:422;return Response.json({ok:false,code:error?.code||'BOOKING_ERROR',message:error?.message||'Booking failed',booking_id:error?.bookingId||null,balance:error?.balance??null},{status});}
};
export const config={path:'/api/v1/bookings',method:'POST',rateLimit:{windowSize:60,windowLimit:120,aggregateBy:'ip',action:'rate_limit'}};
