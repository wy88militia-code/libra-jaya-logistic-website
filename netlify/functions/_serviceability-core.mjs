import { findRoute } from './_master-sheet-core.mjs';
import { calculateRateAmount, defaultCutoffWit, resolvePartnerRate } from './_rate-plan-core.mjs';

const blocked=new Set(['OUT_OF_COVERAGE','NOT_ACTIVE','PENDING_VERIFICATION']);
const conditional=new Set(['MINIMUM_LOAD','ON_REQUEST','CHARTER_REQUIRED','MANUAL_REVIEW']);
const num=value=>{const n=Number(value);return Number.isFinite(n)?n:null;};

export async function checkServiceability(partnerId,input={}){
  const routeResult=await findRoute({kodeRute:input.kodeRute||input.routeCode,kodeWilayah:input.kodeWilayah||input.administrativeCode,kelurahan:input.kelurahan,distrik:input.distrik});
  if(!routeResult){const error=new Error('Rute tidak ditemukan pada Master yang sudah dipublish.');error.code='ROUTE_NOT_FOUND';throw error;}
  const route=routeResult.route;const coverageStatus=String(route.coverageStatus||'NOT_ACTIVE').toUpperCase();const rateResolution=await resolvePartnerRate(partnerId,route);const weightKg=num(input.weightKg);const pricing=weightKg&&weightKg>0&&rateResolution.rate?calculateRateAmount(rateResolution.rate,weightKg):null;
  const unavailable=blocked.has(coverageStatus);const needsApproval=conditional.has(coverageStatus)||(!unavailable&&!rateResolution.rate);const availability=unavailable?'UNAVAILABLE':needsApproval?'CONDITIONAL':'AVAILABLE';const quoteMode=unavailable?'BLOCKED':needsApproval?'MANUAL_APPROVAL':'AUTO';
  return {
    partnerId:String(partnerId),availability,quoteMode,canRequestQuote:!unavailable,automaticPricing:Boolean(!unavailable&&!needsApproval&&rateResolution.rate),
    route:{kodeRute:route.kodeRute,kodeWilayah:route.kodeWilayah,hub:route.hub||route.bandaraAsal||null,moda:route.moda||null,kabupatenKota:route.kabupatenKota,distrik:route.distrik,kelurahan:route.kelurahan,zonaTarif:route.zonaTarif||null,coverageStatus,coverageReason:route.coverageReason||null,serviceScheme:route.skemaLayanan||route.jenisLayanan||null,minimumLoadKg:Number(route.minimumLoadKg)||0,sla:route.slaTotalHub||route.slaLastmile||route.slaMaster||null,titikMulaiSla:route.titikMulaiSla||null,jarakKm:Number.isFinite(Number(route.jarakKm))?Number(route.jarakKm):null,statusVerifikasi:route.statusVerifikasi||null},
    service:{cutoffWit:rateResolution.rate?.cutoffWit||rateResolution.cutoffWit||defaultCutoffWit(),cutoffTimezone:'Asia/Jayapura',minimumChargeKg:rateResolution.rate?Number(rateResolution.rate.minimumChargeKg)||0:null,rateAvailable:Boolean(rateResolution.rate),ratePlanName:rateResolution.planName||null,rateSource:rateResolution.source},
    estimate:pricing?{amount:pricing.totalAmount,currency:'IDR',weightKg:pricing.actualWeightKg,chargeableKg:pricing.chargeableKg,minimumChargeKg:pricing.minimumChargeKg,cutoffWit:pricing.cutoffWit}:null,
    master:{version:routeResult.version,syncedAt:routeResult.syncedAt||null},
  };
}
