import { apiHttpStatus, authenticateApiRequest, writeApiLog } from './_api-auth.mjs';
import { consumeBookingQuota, recordDuplicateBookingSignal } from './_api-policy-core.mjs';
import { createBookingForPartner, createUatBookingForPartner } from './_booking-service.mjs';
import { getQuote } from './_quote-core.mjs';
import { assertPartnerApiLastmileQuote, PARTNER_API_SCOPE } from './_partner-api-scope-core.mjs';

export default async request=>{
  if(request.method!=='POST')return Response.json({message:'Method not allowed'},{status:405});let context;
  try{
    context=await authenticateApiRequest(request);const idem=String(request.headers.get('x-libra-idempotency-key')||'').trim();if(idem.length<8){const e=new Error('x-libra-idempotency-key minimal 8 karakter wajib diisi.');e.code='IDEMPOTENCY_REQUIRED';throw e;}
    const quoteId=String(context.json?.quoteId||context.json?.quote_id||'').trim();const quote=quoteId?await getQuote(quoteId):null;if(!quote){const e=new Error('Quote last-mile wajib tersedia sebelum booking API.');e.code='QUOTE_NOT_FOUND';throw e;}if(quote.partnerId!==context.partner.partnerId){const e=new Error('Quote bukan milik partner ini.');e.code='QUOTE_FORBIDDEN';throw e;}await assertPartnerApiLastmileQuote(quote);
    const amount=Number(quote.amount)||0;await consumeBookingQuota(context.partner.partnerId,context.environment,context.policy,amount);
    const uat=context.environment==='UAT';const result=uat?await createUatBookingForPartner(context.partner,context.json||{},idem):await createBookingForPartner(context.partner,context.json||{},idem,'API');if(result.duplicate)await recordDuplicateBookingSignal(context.partner.partnerId,context.environment,context.policy);await writeApiLog(context,{status:result.duplicate?200:201,action:uat?'BOOKING_UAT_LASTMILE_DJJ':'BOOKING_LASTMILE_DJJ',reference:result.booking.bookingId});
    return Response.json({ok:true,api_scope:PARTNER_API_SCOPE,environment:context.environment,duplicate:result.duplicate,wallet_debited:!uat,booking:{booking_id:result.booking.bookingId,status:result.booking.status,service_type:'LASTMILE_DJJ',origin_hub:'DJJ',partner_reference:result.booking.partnerReference,quote_id:result.booking.quoteId,route_code:result.booking.kodeRute,amount:result.booking.amount,currency:result.booking.currency,sla:result.booking.sla,destination:result.booking.destination,created_at:result.booking.createdAt},wallet_balance:result.balance},{status:result.duplicate?200:201});
  }catch(error){const status=error?.code==='API_SCOPE_FORBIDDEN'?403:error?.code==='INSUFFICIENT_BALANCE'?402:error?.code==='QUOTE_NOT_FOUND'?404:error?.code==='QUOTE_FORBIDDEN'?403:apiHttpStatus(error,422);if(context)await writeApiLog(context,{status,action:context.environment==='UAT'?'BOOKING_UAT_LASTMILE_DJJ':'BOOKING_LASTMILE_DJJ',reference:error?.bookingId||null,error:error?.code||error?.message});return Response.json({ok:false,code:error?.code||'BOOKING_ERROR',message:error?.message||'Booking failed',booking_id:error?.bookingId||null,balance:error?.balance??null},{status});}
};
export const config={path:'/api/v1/bookings',method:'POST',rateLimit:{windowSize:60,windowLimit:120,aggregateBy:'ip',action:'rate_limit'}};
