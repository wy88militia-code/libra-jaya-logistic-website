import { HUB_COST_RULES, LASTMILE_COST_RULES, LOGISTICS_RULE_VERSION } from './_logistics-rule-core.mjs';

const clean=(v,n=120)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const money=v=>Math.max(0,Math.round(Number(v)||0));
const kg2=v=>Math.max(0,Math.round((Number(v)||0)*100)/100);

function normalizeSmuItems(row={}){
  const source=Array.isArray(row.smus)?row.smus:Array.isArray(row.smuItems)?row.smuItems:[];
  if(source.length)return source.map(x=>({smuNumber:upper(x?.smuNumber||x?.number),weightKg:kg2(x?.weightKg)})).filter(x=>x.smuNumber);
  const numbers=Array.isArray(row.smuNumbers)?row.smuNumbers:[row.smuNumber].filter(Boolean);
  const total=kg2(row.chargeableWeightKg||row.weightKg),share=numbers.length?total/numbers.length:0;
  return numbers.map(x=>({smuNumber:upper(x),weightKg:kg2(share)})).filter(x=>x.smuNumber);
}

function normalizeBooking(row={}){
  const bookingId=clean(row.bookingId,120);if(!bookingId)throw new Error('Booking ID wajib untuk alokasi cost SMU.');
  const smus=normalizeSmuItems(row);if(!smus.length)throw new Error(`Booking ${bookingId} belum memiliki SMU untuk alokasi cost per-SMU.`);
  const chargeableWeightKg=kg2(row.chargeableWeightKg||row.finalChargeableWeightKg||row.partnerPtiWeightKg||row.weightKg||smus.reduce((s,x)=>s+x.weightKg,0));
  const p=row.airlinePtpPolicy||row.ptpCostPolicy||{};
  return {
    bookingId,hubCode:upper(row.hubCode),chargeableWeightKg,isDgGadget:Boolean(row.isDgGadget),isFreshFrozen:Boolean(row.isFreshFrozen),isLastmileIncoming:Boolean(row.isLastmileIncoming),smus,
    airlineAdminPerSmu:money(row.airlineAdminPerSmu??p.airlineAdminPerSmu),
    cgkRaIncludedInPtp:Boolean(row.cgkRaIncludedInPtp??p.includesRa),
    cgkWarehouseIncludedInPtp:Boolean(row.cgkWarehouseIncludedInPtp??p.includesOriginWarehouse),
  };
}

function allocateFlat(rows,totalAmount){
  const total=money(totalAmount);if(!rows.length||!total)return rows.map(r=>({...r,allocated:0}));
  const denominator=rows.reduce((s,r)=>s+Math.max(0,Number(r.weightKg)||0),0);
  let allocated=0;
  return rows.map((r,i)=>{
    const amount=i===rows.length-1?total-allocated:denominator>0?Math.round(total*(Math.max(0,Number(r.weightKg)||0)/denominator)):Math.floor(total/rows.length);
    const safe=Math.max(0,amount);allocated+=safe;return {...r,allocated:safe};
  });
}

function pushComponent(map,bookingId,component){
  const row=map.get(bookingId);if(!row)return;row.components.push(component);row.totalCost+=money(component.amount);
}
function auditIncluded(map,bookingId,component){const row=map.get(bookingId);if(row)row.components.push({...component,amount:0,included:true});}

/**
 * Pure deterministic allocator for operational rules agreed by management.
 * Airline freight and airline surcharge remain sourced from airline/vendor master.
 * Per-SMU amounts are deduplicated by SMU number and allocated once.
 *
 * If airline PTP is all-in, pass airlinePtpPolicy/includes flags from the airline
 * master. RA/warehouse are then recorded as INCLUDED instead of charged again.
 * If airlineAdminPerSmu is supplied, it replaces generic CGK SMU handling so the
 * same SMU event is not charged twice.
 */
export function allocateOperationalCosts(inputRows=[]){
  const bookings=(Array.isArray(inputRows)?inputRows:[]).map(normalizeBooking);
  const result=new Map(bookings.map(b=>[b.bookingId,{bookingId:b.bookingId,ruleVersion:LOGISTICS_RULE_VERSION,totalCost:0,components:[]}])) ;

  // Per-kg Soetta rules: respect airline all-in inclusion policy.
  for(const b of bookings){
    const hub=HUB_COST_RULES[b.hubCode];if(hub){
      if(b.cgkRaIncludedInPtp)auditIncluded(result,b.bookingId,{code:'CGK_RA',basis:'INCLUDED_IN_AIRLINE_PTP',qty:b.chargeableWeightKg,rate:hub.raPerKg,hubCode:b.hubCode});
      else pushComponent(result,b.bookingId,{code:'CGK_RA',basis:'PER_KG',qty:b.chargeableWeightKg,rate:hub.raPerKg,amount:money(b.chargeableWeightKg*hub.raPerKg),hubCode:b.hubCode});
      if(b.cgkWarehouseIncludedInPtp)auditIncluded(result,b.bookingId,{code:'CGK_WAREHOUSE_HANDLING',basis:'INCLUDED_IN_AIRLINE_PTP',qty:b.chargeableWeightKg,rate:hub.warehouseHandlingPerKg,hubCode:b.hubCode});
      else pushComponent(result,b.bookingId,{code:'CGK_WAREHOUSE_HANDLING',basis:'PER_KG',qty:b.chargeableWeightKg,rate:hub.warehouseHandlingPerKg,amount:money(b.chargeableWeightKg*hub.warehouseHandlingPerKg),hubCode:b.hubCode});
      if(b.isFreshFrozen)pushComponent(result,b.bookingId,{code:'CGK_QUARANTINE_FRESH_FROZEN',basis:'PER_KG',qty:b.chargeableWeightKg,rate:hub.quarantineFreshFrozenPerKg,amount:money(b.chargeableWeightKg*hub.quarantineFreshFrozenPerKg),hubCode:b.hubCode});
    }
  }

  const smuMap=new Map();
  for(const b of bookings){for(const s of b.smus){const rows=smuMap.get(s.smuNumber)||[];rows.push({bookingId:b.bookingId,weightKg:s.weightKg||b.chargeableWeightKg,hubCode:b.hubCode,isDgGadget:b.isDgGadget,isLastmileIncoming:b.isLastmileIncoming,airlineAdminPerSmu:b.airlineAdminPerSmu});smuMap.set(s.smuNumber,rows);}}

  for(const [smuNumber,rows] of smuMap){
    const cgkRows=rows.filter(r=>r.hubCode==='CGK');
    if(cgkRows.length){
      const adminValues=[...new Set(cgkRows.map(r=>money(r.airlineAdminPerSmu)).filter(v=>v>0))];
      if(adminValues.length>1)throw new Error(`SMU ${smuNumber} memiliki airline admin/SMU yang berbeda dalam satu SMU.`);
      const airlineAdmin=adminValues[0]||0;
      if(airlineAdmin>0){
        for(const a of allocateFlat(cgkRows,airlineAdmin))pushComponent(result,a.bookingId,{code:'AIRLINE_ADMIN_SMU',basis:'PER_SMU_ALLOCATED',smuNumber,smuTotal:airlineAdmin,allocationWeightKg:a.weightKg,amount:a.allocated,hubCode:'CGK'});
        for(const r of cgkRows)auditIncluded(result,r.bookingId,{code:'CGK_SMU_HANDLING',basis:'REPLACED_BY_AIRLINE_ADMIN_SMU',smuNumber,smuTotal:HUB_COST_RULES.CGK.smuHandlingPerSmu,hubCode:'CGK'});
      }else{
        for(const a of allocateFlat(cgkRows,HUB_COST_RULES.CGK.smuHandlingPerSmu))pushComponent(result,a.bookingId,{code:'CGK_SMU_HANDLING',basis:'PER_SMU_ALLOCATED',smuNumber,smuTotal:HUB_COST_RULES.CGK.smuHandlingPerSmu,allocationWeightKg:a.weightKg,amount:a.allocated,hubCode:'CGK'});
      }
    }

    // DG Gadget Rp200k: once per SMU, allocated only to DG gadget bookings.
    const dgRows=rows.filter(r=>r.hubCode==='CGK'&&r.isDgGadget);
    if(dgRows.length){for(const a of allocateFlat(dgRows,HUB_COST_RULES.CGK.dgGadgetPerSmu))pushComponent(result,a.bookingId,{code:'CGK_DG_GADGET_AVSEC',basis:'PER_SMU_DG_ALLOCATED',smuNumber,smuTotal:HUB_COST_RULES.CGK.dgGadgetPerSmu,allocationWeightKg:a.weightKg,amount:a.allocated,hubCode:'CGK'});}

    // Last-mile handling barang Rp25k: once per unique SMU, never per booking/rute.
    const lastmileRows=rows.filter(r=>r.isLastmileIncoming);
    if(lastmileRows.length){for(const a of allocateFlat(lastmileRows,LASTMILE_COST_RULES.handlingBarangPerSmu))pushComponent(result,a.bookingId,{code:'LASTMILE_HANDLING_BARANG',basis:'PER_SMU_ALLOCATED',smuNumber,smuTotal:LASTMILE_COST_RULES.handlingBarangPerSmu,allocationWeightKg:a.weightKg,amount:a.allocated});}
  }

  const rows=[...result.values()].map(r=>({...r,totalCost:money(r.totalCost)}));
  return {ruleVersion:LOGISTICS_RULE_VERSION,bookingCount:rows.length,smuCount:smuMap.size,totalCost:rows.reduce((s,r)=>s+r.totalCost,0),bookings:rows,note:'Airline freight/surcharge belum termasuk; RA/warehouse menghormati inclusion policy airline, dan admin/SMU menggantikan generic CGK SMU handling bila tersedia.'};
}
