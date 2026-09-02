import { getBooking } from './_booking-core.mjs';
import { requirePartnerSession, validAdminSession } from './_partner-core.mjs';
import { getPod } from './_tracking-core.mjs';

export default async request=>{
  const podId=new URL(request.url).searchParams.get('id');if(!podId)return new Response('POD ID required',{status:400});
  const pod=await getPod(podId);if(!pod)return new Response('Not found',{status:404});
  if(!validAdminSession(request)){
    const partner=await requirePartnerSession(request);if(!partner)return new Response('Unauthorized',{status:401});
    const booking=await getBooking(pod.bookingId);if(!booking||booking.partnerId!==partner.partnerId)return new Response('Forbidden',{status:403});
  }
  return new Response(Buffer.from(pod.base64,'base64'),{headers:{'content-type':pod.contentType||'application/octet-stream','content-disposition':`inline; filename="${String(pod.originalName||'pod').replace(/["\r\n]/g,'')}"`,'cache-control':'private, max-age=300','x-content-type-options':'nosniff'}});
};
export const config={path:'/.netlify/functions/pod-media',method:'GET'};
