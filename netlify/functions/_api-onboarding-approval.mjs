import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getOnboardingApplication, linkApplicationToPartner } from './_api-uat-core.mjs';
import { createPartnerActivation } from './_partner-activation.mjs';
import { ensureApiPolicy } from './_api-policy-core.mjs';
import { getPartner, makeApiCredentials, newPinHash, normalizePhone, savePartner } from './_partner-core.mjs';
import { ensureApiPartnerRatePlan } from './_rate-plan-core.mjs';

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
function lockedInitialPin(){return crypto.randomInt(100000,1000000).toString();}
async function saveApplication(application){
  await getStore(ONBOARDING_STORE).setJSON(`application/${application.applicationId}`,application);
}

export async function approveApplicationAndCreateUat(applicationId,adminUser='admin'){
  const application=await getOnboardingApplication(applicationId);
  if(!application)throw new Error('Pengajuan onboarding tidak ditemukan.');
  if(application.partnerId){
    const existing=await getPartner(application.partnerId);
    if(existing)throw new Error(`Pengajuan sudah memiliki Partner ID ${application.partnerId}. Gunakan Buat Link Aktivasi Baru bila partner belum mengambil kredensial.`);
  }
  if(['REJECTED','PRODUCTION_ACTIVE'].includes(String(application.status||'').toUpperCase()))throw new Error(`Pengajuan berstatus ${application.status} dan tidak dapat dibuat ulang.`);

  const partnerId=await uniquePartnerId(application.companyName);
  const apiCredentials=makeApiCredentials();const initialPin=lockedInitialPin();const createdAt=now();
  const partner={
    partnerId,
    companyName:String(application.companyName||'').trim().slice(0,120),
    picName:String(application.picName||'').trim().slice(0,100),
    email:String(application.email||'').trim().toLowerCase().slice(0,120),
    phone:normalizePhone(application.phone),
    status:'ACTIVE',
    ...newPinHash(initialPin),
    ...apiCredentials,
    portalActivated:false,
    onboardingApplicationId:application.applicationId,
    apiLifecycle:'UAT',
    productionAccess:false,
    createdBy:String(adminUser||'admin').slice(0,80),
    createdAt,
    updatedAt:createdAt,
  };

  await savePartner(partner);
  try{
    await ensureApiPartnerRatePlan(partnerId,application.companyName,adminUser);
    await ensureApiPolicy(partnerId,adminUser);
    await linkApplicationToPartner(application.applicationId,partnerId);
    const activation=await createPartnerActivation(partnerId,application.applicationId,{ttlHours:72});
    const latest=await getOnboardingApplication(application.applicationId);
    await saveApplication({
      ...latest,
      partnerId,
      status:'UAT',
      approvedBy:String(adminUser||'admin').slice(0,80),
      approvedAt:createdAt,
      credentialsIssuedAt:createdAt,
      activationIssuedAt:createdAt,
      activationExpiresAt:activation.expiresAt,
      credentialsClaimedAt:null,
      ratePlanStatus:'INACTIVE',
      apiSecurityStatus:'ACTIVE',
      updatedAt:now(),
    });
    return {applicationId:application.applicationId,companyName:application.companyName,partnerId,activationId:activation.activationId,activationToken:activation.token,activationExpiresAt:activation.expiresAt,environment:'UAT'};
  }catch(error){
    await savePartner({...partner,status:'PENDING',apiLifecycle:'SETUP_ERROR',setupError:String(error?.message||'UAT setup failed').slice(0,500),updatedAt:now()});
    throw new Error(`Partner ID ${partnerId} sempat dibuat tetapi UAT/aktivasi/rate plan/security policy gagal disiapkan. Akun dikunci PENDING. ${error?.message||''}`.trim());
  }
}
