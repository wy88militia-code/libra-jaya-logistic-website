import { createPartnerQuote } from './_quote-core.mjs';
import { requirePartnerSession } from './_partner-core.mjs';

export default async request=>{
  const partner=await requirePartnerSession(request);
  if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
  if(request.method!=='POST')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
  let body;try{body=await request.json();}catch{return Response.json({message:'Permintaan tidak valid.'},{status:400});}
  try{
    const quote=await createPartnerQuote(partner.partnerId,body||{});
    return Response.json({ok:true,quote:{quoteId:quote.quoteId,status:quote.status,amount:quote.amount,currency:quote.currency,weightKg:quote.weightKg,kodeRute:quote.kodeRute,kelurahan:quote.kelurahan,distrik:quote.distrik,coverageStatus:quote.coverageStatus,skemaLayanan:quote.skemaLayanan,minimumLoadKg:quote.minimumLoadKg,sla:quote.sla,expiresAt:quote.expiresAt}});
  }catch(error){
    const code=error?.code||'QUOTE_ERROR';
    const status=['OUT_OF_COVERAGE','NOT_ACTIVE','PENDING_VERIFICATION'].includes(code)?422:code==='ROUTE_NOT_FOUND'?404:400;
    return Response.json({ok:false,code,message:error?.message||'Gagal membuat quote.'},{status});
  }
};

export const config={path:'/.netlify/functions/partner-quote',method:'POST',rateLimit:{windowSize:60,windowLimit:30,aggregateBy:'ip',action:'rate_limit'}};
