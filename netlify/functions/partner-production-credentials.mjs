import { getStore } from '@netlify/blobs';
import { buildUatEvidence } from './_api-uat-core.mjs';
import { claimProductionCredentialsOnce, makeProductionApiCredentials, requirePartnerSession } from './_partner-core.mjs';

const PARTNER_STORE='libra-partners';
const now=()=>new Date().toISOString();

async function ensureProductionCredentials(partnerId){
  const store=getStore(PARTNER_STORE);const key=`partner/${partnerId}`;
  for(let attempt=0;attempt<6;attempt+=1){
    const entry=await store.getWithMetadata(key,{type:'json',consistency:'strong'});const partner=entry?.data;
    if(!partner)throw new Error('Partner tidak ditemukan.');
    if(partner.productionApiKey&&partner.productionApiSecret)return partner;
    const credentials=makeProductionApiCredentials();const updatedAt=now();const next={...partner,...credentials,productionCredentialStatus:'READY_TO_CLAIM',productionCredentialsIssuedAt:updatedAt,productionCredentialsClaimedAt:null,updatedAt};
    const result=await store.setJSON(key,next,{onlyIfMatch:entry.etag});if(!result.modified)continue;
    await store.set(`apikey/${next.productionApiKey}`,partnerId);return next;
  }
  const error=new Error('Penerbitan kredensial Production sedang diproses. Coba kembali.');error.code='PRODUCTION_CREDENTIALS_BUSY';throw error;
}

export default async request=>{
  if(request.method!=='POST')return Response.json({message:'Method not allowed'},{status:405});
  const partner=await requirePartnerSession(request);if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401,headers:{'cache-control':'no-store'}});
  if(!partner.onboardingApplicationId)return Response.json({message:'Partner ini bukan partner API onboarding.'},{status:403,headers:{'cache-control':'no-store'}});
  try{
    const evidence=await buildUatEvidence(partner.partnerId);if(!evidence.record?.productionEnabled)return Response.json({message:'Production API belum diaktifkan Admin Libra.'},{status:409,headers:{'cache-control':'no-store'}});
    if(evidence.record.finalDecision!=='PASS'||!evidence.wallet.depositReady)return Response.json({message:'Final PASS dan minimum opening deposit harus terpenuhi sebelum kredensial Production diterbitkan.'},{status:409,headers:{'cache-control':'no-store'}});
    await ensureProductionCredentials(partner.partnerId);
    const result=await claimProductionCredentialsOnce(partner.partnerId);
    return Response.json({ok:true,credentials:result.credentials,warning:'API Secret Production hanya ditampilkan pada response ini. Simpan di secret manager perusahaan. Jika hilang, minta Admin Libra melakukan rotasi kredensial.'},{headers:{'cache-control':'no-store, max-age=0','pragma':'no-cache','referrer-policy':'no-referrer'}});
  }catch(error){const status=error?.code==='PRODUCTION_CREDENTIALS_ALREADY_CLAIMED'?409:error?.code==='PRODUCTION_CREDENTIALS_BUSY'?409:500;return Response.json({message:error?.message||'Kredensial Production gagal diterbitkan.',code:error?.code||null},{status,headers:{'cache-control':'no-store'}});}
};

export const config={path:'/.netlify/functions/partner-production-credentials',method:'POST',rateLimit:{windowSize:60,windowLimit:5,aggregateBy:'ip',action:'rate_limit'}};
