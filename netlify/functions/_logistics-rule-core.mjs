// Central business rules for JL Express / Libra Partner Web.
// Source-of-truth decision record: LOGISTICS_PRICING_WEIGHT_ACCURATE_RULES.md
// Keep monetary rules here as configuration facts; do not blindly charge per-SMU
// components at booking level because one SMU may contain multiple bookings.

const toNumber=value=>Number.isFinite(Number(value))?Number(value):null;
const kg2=value=>Math.round(Number(value||0)*100)/100;
const upper=value=>String(value??'').trim().toUpperCase();

export const LOGISTICS_RULE_VERSION='2026-09-05.2';
export const WEIGHT_CLEAR_THRESHOLD_KG=0.2;

export const HUB_COST_RULES=Object.freeze({
  CGK:Object.freeze({
    hubCode:'CGK',
    hubName:'Soetta',
    raPerKg:2500,
    warehouseHandlingPerKg:1000,
    smuHandlingPerSmu:20000,
    dgGadgetPerSmu:200000,
    quarantineFreshFrozenPerKg:500,
    currency:'IDR',
  }),
});

export const LASTMILE_COST_RULES=Object.freeze({
  handlingBarangPerSmu:25000,
  currency:'IDR',
});

export const CHANNEL_POLICY=Object.freeze({
  JL_EXPRESS:Object.freeze({
    services:['DOOR_TO_PORT','PORT_TO_PORT','PORT_TO_DOOR','DOOR_TO_DOOR'],
    fullPricingEngine:true,
  }),
  LIBRA_PARTNER_WEB:Object.freeze({
    services:['PORT_TO_DOOR'],
    alias:'LASTMILE_INCOMING',
    weightBasis:'PARTNER_PTI',
    airlineCost:false,
  }),
});

/**
 * Final outgoing tolerance rule agreed by management:
 * abs(final Libra chargeable - customer declared) < 0.20 kg => CLEAR.
 * Exactly 0.20 kg or more => WEIGHT_ADJUSTMENT.
 * We compare hundredths of kg so floating-point representation cannot turn
 * an exact 0.20 kg difference into 0.199999... by accident.
 */
export function classifyOutgoingWeight(customerDeclaredWeightKg,finalChargeableWeightKg){
  const declared=toNumber(customerDeclaredWeightKg),finalWeight=toNumber(finalChargeableWeightKg);
  if(!(declared>=0)||!(finalWeight>=0))throw new Error('Berat declared/final tidak valid untuk klasifikasi selisih.');
  const declaredHundredths=Math.round(declared*100),finalHundredths=Math.round(finalWeight*100);
  const deltaHundredths=Math.abs(finalHundredths-declaredHundredths);
  const deltaKg=deltaHundredths/100;
  const clear=deltaHundredths<20;
  return {
    customerDeclaredWeightKg:declaredHundredths/100,
    finalChargeableWeightKg:finalHundredths/100,
    weightDeltaKg:deltaKg,
    weightStatus:clear?'CLEAR':'WEIGHT_ADJUSTMENT',
    customerReapprovalRequired:!clear,
    thresholdKg:WEIGHT_CLEAR_THRESHOLD_KG,
    ruleVersion:LOGISTICS_RULE_VERSION,
  };
}

export function getHubCostRule(hubCode){
  const code=upper(hubCode);
  return HUB_COST_RULES[code]||null;
}

/** Returns applicability/rates only. It intentionally does NOT calculate a
 * booking total for per-SMU charges, because those must be allocated once at
 * SMU/consolidation level to prevent double charging. */
export function describeOperationalCostRules(input={}){
  const hubCode=upper(input.hubCode),hub=getHubCostRule(hubCode);
  const isDgGadget=Boolean(input.isDgGadget),isFreshFrozen=Boolean(input.isFreshFrozen),isLastmileIncoming=Boolean(input.isLastmileIncoming);
  return {
    ruleVersion:LOGISTICS_RULE_VERSION,
    hubCode:hubCode||null,
    hubRule:hub?{
      raPerKg:hub.raPerKg,
      warehouseHandlingPerKg:hub.warehouseHandlingPerKg,
      smuHandlingPerSmu:hub.smuHandlingPerSmu,
      dgGadgetPerSmu:isDgGadget?hub.dgGadgetPerSmu:0,
      quarantineFreshFrozenPerKg:isFreshFrozen?hub.quarantineFreshFrozenPerKg:0,
    }:null,
    lastmileHandlingBarangPerSmu:isLastmileIncoming?LASTMILE_COST_RULES.handlingBarangPerSmu:0,
    perSmuAllocationRequired:Boolean((hub?.smuHandlingPerSmu||0)||(isDgGadget&&hub?.dgGadgetPerSmu)||(isLastmileIncoming&&LASTMILE_COST_RULES.handlingBarangPerSmu)),
    note:'Per-SMU cost wajib dikenakan sekali di level SMU/consolidation lalu dialokasikan; jangan dikali jumlah booking. Untuk PTP airline all-in, inclusion policy airline wajib mengalahkan generic CGK components agar RA/gudang/SMU tidak dobel.',
  };
}

export function normalizeKg(value){return kg2(value);}
