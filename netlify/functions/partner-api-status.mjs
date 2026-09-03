import { buildUatEvidence, getOnboardingApplication } from './_api-uat-core.mjs';
import { requirePartnerSession } from './_partner-core.mjs';
import { getRatePlan } from './_rate-plan-core.mjs';
import { listWebhookDeliveries } from './_partner-webhook.mjs';

function maskedKey(value){const s=String(value||'');if(!s)return null;return s.length<=12?'••••••':`${s.slice(0,7)}••••${s.slice(-4)}`;}
function safeChecks(checks={}){return Object.fromEntries(Object.entries(checks).map(([key,value])=>[key,{status:value?.status||'NOT_TESTED',detail:value?.detail||''}]));}

export default async request=>{
  if(request.method!=='GET')return Response.json({message:'Method not allowed'},{status:405});
  const partner=await requirePartnerSession(request);if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
  if(!partner.onboardingApplicationId)return Response.json({message:'Partner ini tidak terdaftar sebagai partner API.'},{status:404});
  try{
    const evidence=await buildUatEvidence(partner.partnerId);if(!evidence.record)return Response.json({message:'Lifecycle UAT belum tersedia.'},{status:409});
    const [application,deliveries,ratePlan]=await Promise.all([getOnboardingApplication(partner.onboardingApplicationId),listWebhookDeliveries(partner.partnerId,12),getRatePlan(partner.partnerId)]);
    const ai=evidence.record.aiAnalysis;const productionEnabled=Boolean(evidence.record.productionEnabled);const productionCredentialStatus=!productionEnabled?'LOCKED':partner.productionCredentialsClaimedAt?'CLAIMED':'READY_TO_CLAIM';const dashboardStage=productionEnabled&&!partner.productionCredentialsClaimedAt?'PRODUCTION_CREDENTIALS_PENDING':evidence.stage;
    const activeRules=(ratePlan?.rules||[]).filter(rule=>rule.active!==false);const defaultRule=activeRules.find(rule=>rule.matchType==='DEFAULT');
    return Response.json({ok:true,partner:{partnerId:partner.partnerId,companyName:partner.companyName,picName:partner.picName,apiKeyMasked:maskedKey(partner.apiKey),productionApiKeyMasked:partner.productionCredentialsClaimedAt?maskedKey(partner.productionApiKey):null,portalActivated:Boolean(partner.portalActivated),portalActivatedAt:partner.portalActivatedAt||null},onboarding:{applicationId:partner.onboardingApplicationId,status:application?.status||null,callbackUrl:application?.callbackUrl||null},uat:{stage:dashboardStage,baselineVerdict:evidence.baselineVerdict,finalDecision:evidence.record.finalDecision||'PENDING',productionEnabled,checks:safeChecks(evidence.checks),webhookStatus:evidence.record.webhookStatus||'NOT_TESTED',webhookNote:evidence.record.webhookNote||'',lastWebhookTestAt:evidence.record.lastWebhookTestAt||null,aiAnalysis:ai?{verdict:ai.verdict,confidence:ai.confidence,summary:ai.summary,blockers:Array.isArray(ai.blockers)?ai.blockers:[],nextActions:Array.isArray(ai.next_actions)?ai.next_actions:[],analyzedAt:ai.analyzedAt||null}:null},productionCredentials:{status:productionCredentialStatus,issuedAt:partner.productionCredentialsIssuedAt||null,claimedAt:partner.productionCredentialsClaimedAt||null,apiKeyMasked:partner.productionCredentialsClaimedAt?maskedKey(partner.productionApiKey):null},ratePlan:{status:ratePlan?.status||'NOT_CONFIGURED',planName:ratePlan?.planName||null,ruleCount:activeRules.length,defaultMinimumChargeKg:defaultRule?Number(defaultRule.minimumChargeKg)||0:null,defaultCutoffWit:defaultRule?.cutoffWit||null,serviceabilityEndpoint:'/api/v1/serviceability'},wallet:evidence.wallet,webhookDeliveries:deliveries.map(d=>({deliveryId:d.deliveryId,createdAt:d.createdAt,eventType:d.eventType,environment:d.environment,status:d.status,attempts:d.attempts,maxAttempts:d.maxAttempts,lastHttpStatus:d.lastHttpStatus,lastError:d.lastError,deliveredAt:d.deliveredAt}))});
  }catch(error){return Response.json({message:error?.message||'Status API partner gagal dimuat.'},{status:500});}
};
export const config={path:'/.netlify/functions/partner-api-status',method:'GET',rateLimit:{windowSize:60,windowLimit:120,aggregateBy:'ip',action:'rate_limit'}};
