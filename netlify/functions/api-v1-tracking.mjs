import { authenticateApiRequest, writeApiLog } from './_api-auth.mjs';
import { getBooking } from './_booking-core.mjs';
import { listTrackingEvents } from './_tracking-core.mjs';

export default async request=>{
  if(request.method!=='GET')return Response.json({message:'Method not allowed'},{status:405});let context;
  try{context=await authenticateApiRequest(request);const bookingId=String(context.url.searchParams.get('booking_id')||'').trim();if(!bookingId){const e=new Error('booking_id wajib diisi.');e.code='BOOKING_ID_REQUIRED';throw e;}const booking=await getBooking(bookingId);if(!booking){const e=new Error('Booking tidak ditemukan.');e.code='BOOKING_NOT_FOUND';throw e;}if(booking.partnerId!==context.partner.partnerId){const e=new Error('Booking bukan milik partner ini.');e.code='BOOKING_FORBIDDEN';throw e;}const events=await listTrackingEvents(bookingId,200);await writeApiLog(context,{status:200,action:'TRACKING',reference:bookingId});return Response.json({ok:true,booking_id:bookingId,status:booking.status,sla:booking.sla,delivered_at:booking.deliveredAt||null,receiver_name:booking.receiverName||null,pod_available:Boolean(booking.podId),events:events.map(e=>({status:e.status,created_at:e.createdAt,note:e.note,condition:e.condition,claim_status:e.claimStatus,claim_reference:e.claimReference}))});}
  catch(error){if(context)await writeApiLog(context,{status:404,action:'TRACKING',error:error?.code||error?.message});const auth=String(error?.code||'').startsWith('API_');return Response.json({ok:false,code:error?.code||'TRACKING_ERROR',message:error?.message||'Tracking failed'},{status:auth?401:error?.code==='BOOKING_FORBIDDEN'?403:error?.code==='BOOKING_NOT_FOUND'?404:400});}
};
export const config={path:'/api/v1/tracking',method:'GET',rateLimit:{windowSize:60,windowLimit:240,aggregateBy:'ip',action:'rate_limit'}};
