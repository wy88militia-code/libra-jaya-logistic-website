import { requirePartnerSession } from './_partner-core.mjs';
import { buildPartnerReconciliation, reconciliationCsv } from './_reconciliation-core.mjs';

export default async request=>{
  if(request.method!=='GET')return Response.json({message:'Method not allowed'},{status:405});
  const partner=await requirePartnerSession(request);if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
  try{const url=new URL(request.url);const report=await buildPartnerReconciliation(partner.partnerId,url.searchParams.get('month'));if(url.searchParams.get('format')==='csv')return new Response(reconciliationCsv(report),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="libra-reconciliation-${partner.partnerId}-${report.period.month}.csv"`,'cache-control':'no-store'}});return Response.json({ok:true,...report},{headers:{'cache-control':'no-store'}});}catch(error){return Response.json({ok:false,message:error?.message||'Rekonsiliasi gagal dimuat.'},{status:400});}
};
export const config={path:'/.netlify/functions/partner-reconciliation',method:'GET',rateLimit:{windowSize:60,windowLimit:60,aggregateBy:'ip',action:'rate_limit'}};
