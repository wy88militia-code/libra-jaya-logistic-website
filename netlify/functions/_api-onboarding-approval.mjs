import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getOnboardingApplication, linkApplicationToPartner } from './_api-uat-core.mjs';
import { getPartner, makeApiCredentials, newPinHash, normalizePhone, savePartner } from './_partner-core.mjs';

const ONBOARDING_STORE='libra-api-onboarding';
const now=()=>new Date().toISOString();

function companyPrefix(name){
  const clean=String(name||'').toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,6);
  return clean||'PARTNR';
}
async function uniquePartnerId(companyName){
  const prefix=companyPrefix(companyName);
  for(let i=0;i<20;i+=1){
    const candidate=`API-${prefix}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    if(!await getPartner(candidate))return candidate;
  }
  throw new Error('Gagal membuat Partner ID unik. Coba kembali.');
}
function temporaryPin(){return crypto.randomInt(100000,1000000).toString();}
async function saveApplication(application){
  await getStore(ONBOARDING_STORE).setJSON(`application/${application.applicationId}`,application);
}

export async function approveApplicationAndCreateUat(applicationId,adminUser='admin'){
  const application=await getOnboardingApplication(applicationId);
  if(!application)throw new Error('Pengajuan onboarding tidak ditemukan.');
  if(application.partnerId){
    const existing=await getPartner(application.partnerId);
    if(existing)throw new Error(`Pengajuan sudah memiliki Partner ID ${application.partnerId}. Kredensial lama tidak ditampilkan ulang; gunakan rotasi bila diperlukan.`);
  }
  if(['REJECTED','PRODUCTION_ACTIVE'].includes(String(application.status||'').toUpperCase()))throw new Error(`Pengajuan berstatus ${application.status} dan tidak dapat dibuat ulang.`);

  const partnerId=await uniquePartnerId(application.companyName);
  const pin=temporaryPin();
  const apiCredentials=makeApiCredentials();
  const createdAt=now();
  const partner={
    partnerId,
    companyName:String(application.companyName||'').trim().slice(0,120),
    picName:String(application.picName||'').trim().slice(0,100),
    email:String(application.email||'').trim().toLowerCase().slice(0,120),
    phone:normalizePhone(application.phone),
    status:'ACTIVE',
    ...newPinHash(pin),
    ...apiCredentials,
    onboardingApplicationId:application.applicationId,
    apiLifecycle:'UAT',
    productionAccess:false,
    createdBy:String(adminUser||'admin').slice(0,80),
    createdAt,
    updatedAt:createdAt,
  };

  await savePartner(partner);
  try{
    const linked=await linkApplicationToPartner(application.applicationId,partnerId);
    const latest=await getOnboardingApplication(application.applicationId);
    await saveApplication({
      ...latest,
      partnerId,
      status:'UAT',
      approvedBy:String(adminUser||'admin').slice(0,80),
      approvedAt:createdAt,
      credentialsIssuedAt:createdAt,
      updatedAt:now(),
    });
    return {
      applicationId:application.applicationId,
      companyName:application.companyName,
      partnerId,
      temporaryPin:pin,
      apiKey:apiCredentials.apiKey,
      apiSecret:apiCredentials.apiSecret,
      webhookSecret:linked.createdWebhookSecret||null,
      environment:'UAT',
    };
  }catch(error){
    await savePartner({...partner,status:'PENDING',apiLifecycle:'SETUP_ERROR',setupError:String(error?.message||'UAT setup failed').slice(0,500),updatedAt:now()});
    throw new Error(`Partner ID ${partnerId} sempat dibuat tetapi UAT gagal dihubungkan. Akun dikunci PENDING. ${error?.message||''}`.trim());
  }
}
