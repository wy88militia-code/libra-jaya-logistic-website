import { billingStatementCsv, buildBillingStatement, getIssuedBillingStatement } from './_billing-core.mjs';
import { requirePartnerSession } from './_partner-core.mjs';

export default async request=>{
 const partner=await requirePartnerSession(request);if(!partner)return Response.json({message:'Unauthorized'},{status:401});if(request.method!=='GET')return Response.json({message:'Method not allowed'},{status:405});const url=new URL(request.url);const month=url.searchParams.get('month');try{const issued=await getIssuedBillingStatement(partner.partnerId,month);const live=await buildBillingStatement(partner.partnerId,month);const report=issued||live;if(url.searchParams.get('format')==='csv')return new Response(billingStatementCsv(report),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="billing-${partner.partnerId}-${report.period.month}.csv"`,'cache-control':'no-store'}});return Response.json({...report,latestLiveSummary:live.summary,issued:Boolean(issued)},{headers:{'cache-control':'no-store'}});}catch(error){return Response.json({message:error?.message||'Billing statement gagal dimuat.'},{status:400,headers:{'cache-control':'no-store'}});}
};
export const config={path:'/.netlify/functions/partner-billing',method:'GET'};
