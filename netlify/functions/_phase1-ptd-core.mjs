import { HUB_COST_RULES, LASTMILE_COST_RULES } from './_logistics-rule-core.mjs';

const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const num=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const money=v=>Math.max(0,Math.round(num(v)));
const kg2=v=>Math.max(0,Math.round(num(v)*100)/100);

export const PHASE1_PTD_RULE_VERSION='2026-09-05.1';
export const PHASE1_MARKETPLACE_RECEIVER='INDRI';
export const PHASE1_PTD_ROUTE=Object.freeze({originHub:'CGK',destinationHub:'DJJ',product:'PORT_TO_DOOR'});
export const PHASE1_PTD_SERVICES=Object.freeze({
  REGULAR:Object.freeze({code:'PTD_CGK_DJJ_REGULAR',label:'Reguler Port to Door CGK-DJJ',customerMinimumChargeKg:0,consolidationDays:3,priority:false}),
  ONS:Object.freeze({code:'PTD_CGK_DJJ_ONS',label:'ONS Port to Door CGK-DJJ',customerMinimumChargeKg:10,consolidationDays:0,priority:true}),
});

export function resolvePhase1PtdService(value){
  const code=upper(value).replace(/[\s-]+/g,'_');
  if(['PTD_CGK_DJJ_REGULAR','PHASE1_REGULAR','REGULAR_PTD_CGK_DJJ'].includes(code))return PHASE1_PTD_SERVICES.REGULAR;
  if(['PTD_CGK_DJJ_ONS','PHASE1_ONS','ONS_PTD_CGK_DJJ'].includes(code))return PHASE1_PTD_SERVICES.ONS;
  return null;
}

export function phase1CustomerChargeableKg(service,finalChargeableWeightKg){
  const policy=typeof service==='object'&&service?.code?service:resolvePhase1PtdService(service);
  if(!policy)throw new Error('Service Tahap 1 tidak dikenali.');
  const weight=kg2(finalChargeableWeightKg);if(weight<=0)throw new Error('Berat final Tahap 1 wajib lebih dari 0 kg.');
  return kg2(Math.max(weight,policy.customerMinimumChargeKg));
}

export function phase1ConsolidationWindow(firstReceivedAt,service='PTD_CGK_DJJ_REGULAR'){
  const policy=typeof service==='object'&&service?.code?service:resolvePhase1PtdService(service);if(!policy)throw new Error('Service Tahap 1 tidak dikenali.');
  const start=new Date(firstReceivedAt);if(Number.isNaN(start.getTime()))throw new Error('Waktu paket pertama diterima tidak valid.');
  const closesAt=new Date(start.getTime()+policy.consolidationDays*86400000);
  return {serviceCode:policy.code,firstReceivedAt:start.toISOString(),consolidationDays:policy.consolidationDays,closesAt:closesAt.toISOString(),sendImmediately:policy.priority};
}

/**
 * Airline PTP inclusion policy. The master note is authoritative. Garuda/Citilink
 * CGK-DJJ currently states PTP all-in includes RA + origin warehouse. Airline
 * admin-per-SMU remains a separate vendor charge, and replaces the generic CGK
 * SMU handling so the same operational event is never charged twice.
 */
export function resolveAirlinePtpCostPolicy(input={}){
  const id=upper(input.airlineId),name=upper(input.airlineName),notes=upper(input.notes),joined=`${id} ${name} ${notes}`;
  const explicitAllIn=/PTP\s+ALL[ -]?IN/.test(joined)||/ALL[ -]?IN.*RA/.test(joined);
  const includesRa=explicitAllIn&&(/TERMASUK\s+RA/.test(joined)||/RA\s*\+/.test(joined)||/RA\//.test(joined));
  const includesOriginWarehouse=explicitAllIn&&(/GUDANG\s+KEBERANGKATAN/.test(joined)||/RA\/GUDANG/.test(joined)||/RA\s*\+\s*GUDANG/.test(joined));
  const airlineAdminPerSmu=money(input.adminPerSmu);
  return {
    airlineId:id||null,airlineName:clean(input.airlineName,120)||null,
    includesRa,includesOriginWarehouse,airlineAdminPerSmu,
    genericCgkSmuHandlingRequired:airlineAdminPerSmu<=0,
    policySource:notes?'AIRLINE_MASTER_NOTE':'INPUT',
    ruleVersion:PHASE1_PTD_RULE_VERSION,
  };
}

/** Vendor/batch cost only. Customer selling margin is deliberately excluded. */
export function calculatePhase1PtpVendorBatchCost(input={}){
  const batchWeightKg=kg2(input.batchWeightKg),vendorMinKg=kg2(input.vendorMinKg),ratePerKg=money(input.airlineRatePerKg);
  if(batchWeightKg<=0||ratePerKg<=0)throw new Error('Berat batch dan rate airline wajib tersedia.');
  const policy=input.policy||resolveAirlinePtpCostPolicy(input),vendorChargeableKg=kg2(Math.max(batchWeightKg,vendorMinKg));
  const hub=HUB_COST_RULES.CGK;
  const airlineFreight=money(vendorChargeableKg*ratePerKg),airlineAdminPerSmu=money(policy.airlineAdminPerSmu||input.adminPerSmu);
  const raSeparate=policy.includesRa?0:money(vendorChargeableKg*hub.raPerKg);
  const warehouseSeparate=policy.includesOriginWarehouse?0:money(vendorChargeableKg*hub.warehouseHandlingPerKg);
  const genericSmuHandling=airlineAdminPerSmu>0?0:money(hub.smuHandlingPerSmu);
  const total=airlineFreight+airlineAdminPerSmu+raSeparate+warehouseSeparate+genericSmuHandling;
  return {
    ruleVersion:PHASE1_PTD_RULE_VERSION,batchWeightKg,vendorMinKg,vendorChargeableKg,ratePerKg,total,
    components:[
      {code:'AIRLINE_FREIGHT',amount:airlineFreight,basis:'PER_KG_VENDOR',qty:vendorChargeableKg,rate:ratePerKg},
      {code:'AIRLINE_ADMIN_SMU',amount:airlineAdminPerSmu,basis:'PER_UNIQUE_SMU'},
      {code:'CGK_RA',amount:raSeparate,basis:policy.includesRa?'INCLUDED_IN_AIRLINE_PTP':'PER_KG',included:policy.includesRa},
      {code:'CGK_WAREHOUSE_HANDLING',amount:warehouseSeparate,basis:policy.includesOriginWarehouse?'INCLUDED_IN_AIRLINE_PTP':'PER_KG',included:policy.includesOriginWarehouse},
      {code:'CGK_SMU_HANDLING',amount:genericSmuHandling,basis:airlineAdminPerSmu>0?'REPLACED_BY_AIRLINE_ADMIN_SMU':'PER_UNIQUE_SMU',included:airlineAdminPerSmu>0},
    ],
    policy,
  };
}

export function phase1LastmileHandlingPerUniqueSmu(){return money(LASTMILE_COST_RULES.handlingBarangPerSmu);}

export function phase1RuleSummary(){return {
  ruleVersion:PHASE1_PTD_RULE_VERSION,route:PHASE1_PTD_ROUTE,marketplaceReceiver:PHASE1_MARKETPLACE_RECEIVER,
  services:PHASE1_PTD_SERVICES,lastmileHandlingPerUniqueSmu:phase1LastmileHandlingPerUniqueSmu(),
  notes:['REGULAR dikonsolidasikan 3 hari dan tidak memiliki minimum 10 kg per customer.','ONS tidak menunggu konsolidasi reguler dan minimum billing customer 10 kg.','Minimum vendor airline tetap berlaku di level SMU/batch.','Handling incoming DJJ Rp25.000 berlaku sekali per unique SMU dan dialokasikan di level SMU/batch.'],
};}
