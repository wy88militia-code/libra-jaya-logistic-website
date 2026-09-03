import { authenticateApiRequest, writeApiLog } from './_api-auth.mjs';
import { createPartnerQuote } from './_quote-core.mjs';

export default async request=>{
  if(request.method!=='POST')return Response.json({message:'Method not allowed'},{status:405});let context;
  try{
    context=await authenticateApiRequest(request);const quote=await createPartnerQuote(context.partner.partnerId,context.json||{});await writeApiLog(context,{status:200,action:'QUOTE',reference:quote.quoteId});
    return Response.json({ok:true,quote:{quote_id:quote.quoteId,status:quote.status,amount:quote.amount,currency:quote.currency,weight_kg:quote.weightKg,chargeable_kg:quote.chargeableKg,route_code:quote.kodeRute,administrative_code:quote.kodeWilayah,destination:{kelurahan:quote.kelurahan,distrik:quote.distrik},coverage_status:quote.coverageStatus,service_scheme:quote.skemaLayanan,minimum_load_kg:quote.minimumLoadKg,sla:quote.sla,cutoff_wit:quote.cutoffWit,rate_plan:quote.ratePlanName,pricing:quote.pricingBreakdown?{minimum_chargeable_kg:quote.pricingBreakdown.minimumChargeKg,rate_per_kg:quote.pricingBreakdown.ratePerKg,base_amount:quote.pricingBreakdown.baseAmount,surcharge_pct:quote.pricingBreakdown.surchargePct,surcharge_amount:quote.pricingBreakdown.surchargeAmount,fixed_fee:quote.pricingBreakdown.fixedFee,handling_fee:quote.pricingBreakdown.handlingFee,total_amount:quote.pricingBreakdown.totalAmount}:null,expires_at:quote.expiresAt}});
  }
  catch(error){const auth=String(error?.code||'').startsWith('API_');const status=auth?401:['OUT_OF_COVERAGE','NOT_ACTIVE','PENDING_VERIFICATION'].includes(error?.code)?422:error?.code==='ROUTE_NOT_FOUND'?404:400;if(context)await writeApiLog(context,{status,action:'QUOTE',error:error?.code||error?.message});return Response.json({ok:false,code:error?.code||'QUOTE_ERROR',message:error?.message||'Quote failed'},{status});}
};
export const config={path:'/api/v1/quote',method:'POST',rateLimit:{windowSize:60,windowLimit:120,aggregateBy:'ip',action:'rate_limit'}};
