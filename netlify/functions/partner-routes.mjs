import { getMasterSnapshot } from './_master-sheet-core.mjs';
import { requirePartnerSession } from './_partner-core.mjs';

export default async request=>{
  const partner=await requirePartnerSession(request);
  if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
  if(request.method!=='GET')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
  const snapshot=await getMasterSnapshot();
  if(!snapshot)return Response.json({message:'Master rute belum dipublish oleh admin.'},{status:503});
  const blocked=new Set(['OUT_OF_COVERAGE','NOT_ACTIVE','PENDING_VERIFICATION']);
  const routes=(snapshot.routes||[]).filter(r=>!blocked.has(String(r.coverageStatus||''))).map(r=>({kodeRute:r.kodeRute,kodeWilayah:r.kodeWilayah,provinsi:r.provinsi,kelurahan:r.kelurahan,distrik:r.distrik,kabupatenKota:r.kabupatenKota,hub:r.bandaraAsal||r.hub,networkHub:r.hub,moda:r.moda,zonaTarif:r.zonaTarif,coverageStatus:r.coverageStatus,skemaLayanan:r.skemaLayanan||r.jenisLayanan,minimumLoadKg:r.minimumLoadKg||null,sla:r.slaTotalHub||r.slaLastmile||r.slaMaster||null})).sort((a,b)=>`${a.hub} ${a.provinsi} ${a.kabupatenKota} ${a.distrik} ${a.kelurahan}`.localeCompare(`${b.hub} ${b.provinsi} ${b.kabupatenKota} ${b.distrik} ${b.kelurahan}`,'id'));
  return Response.json({ok:true,partnerId:partner.partnerId,masterVersion:snapshot.version,syncedAt:snapshot.syncedAt,routes},{headers:{'cache-control':'no-store'}});
};
export const config={path:'/.netlify/functions/partner-routes',method:'GET',rateLimit:{windowSize:60,windowLimit:60,aggregateBy:'ip',action:'rate_limit'}};