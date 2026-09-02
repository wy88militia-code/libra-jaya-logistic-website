import { getQuote } from './_quote-core.mjs';
import { requirePartnerSession } from './_partner-core.mjs';
export default async request=>{
 const partner=await requirePartnerSession(request);if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
 const id=String(new URL(request.url).searchParams.get('quoteId')||'').trim();if(!id)return Response.json({message:'Quote ID wajib diisi.'},{status:400});
 const q=await getQuote(id);if(!q)return Response.json({message:'Quote tidak ditemukan.'},{status:404});if(q.partnerId!==partner.partnerId)return Response.json({message:'Quote bukan milik partner ini.'},{status:403});
 return Response.json({ok:true,quote:{quoteId:q.quoteId,status:q.status,amount:q.amount,currency:q.currency,weightKg:q.weightKg,kodeRute:q.kodeRute,kodeWilayah:q.kodeWilayah,kelurahan:q.kelurahan,distrik:q.distrik,kabupatenKota:q.kabupatenKota,coverageStatus:q.coverageStatus,skemaLayanan:q.skemaLayanan,minimumLoadKg:q.minimumLoadKg,sla:q.sla,expiresAt:q.expiresAt}} ,{headers:{'cache-control':'no-store'}});
};
export const config={path:'/.netlify/functions/partner-quote-status',method:'GET'};