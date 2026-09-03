import { requirePartnerSession } from './_partner-core.mjs';
import { getUatRecord } from './_api-uat-core.mjs';
import { testPartnerWebhook } from './_partner-webhook.mjs';

export default async request=>{
  if(request.method!=='POST')return Response.json({message:'Method not allowed'},{status:405});
  const partner=await requirePartnerSession(request);if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
  if(!partner.onboardingApplicationId)return Response.json({message:'Partner ini bukan partner API.'},{status:404});
  const record=await getUatRecord(partner.partnerId);if(!record)return Response.json({message:'Lifecycle UAT belum tersedia.'},{status:409});
  if(record.productionEnabled)return Response.json({message:'Production sudah aktif; test webhook UAT tidak diperlukan.'},{status:409});
  try{const delivery=await testPartnerWebhook(partner.partnerId);return Response.json({ok:true,status:delivery.status,httpStatus:delivery.lastHttpStatus||null,error:delivery.lastError||null,deliveryId:delivery.deliveryId,attempts:delivery.attempts});}
  catch(error){return Response.json({message:error?.message||'Test webhook gagal.'},{status:400});}
};
export const config={path:'/.netlify/functions/partner-api-webhook-test',method:'POST',rateLimit:{windowSize:60,windowLimit:5,aggregateBy:'ip',action:'rate_limit'}};
