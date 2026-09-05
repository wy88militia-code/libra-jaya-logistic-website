import { allocateOperationalCosts } from './_smu-cost-allocation-core.mjs';
import { calculatePhase1PtpVendorBatchCost, phase1CustomerChargeableKg, resolveAirlinePtpCostPolicy } from './_phase1-ptd-core.mjs';

function assert(name,condition,detail){if(!condition){const e=new Error(`${name}: ${detail}`);e.check=name;throw e;}return {name,status:'PASS',detail};}
function component(row,code){return (row?.components||[]).find(x=>x.code===code);}

export function runPhase1PtdSelfTest(){
  const checks=[];
  checks.push(assert('REGULAR_NO_10KG_MIN',phase1CustomerChargeableKg('PTD_CGK_DJJ_REGULAR',3)===3,'Reguler 3 kg tetap 3 kg customer chargeable.'));
  checks.push(assert('ONS_10KG_MIN',phase1CustomerChargeableKg('PTD_CGK_DJJ_ONS',3)===10,'ONS 3 kg menjadi minimum billing 10 kg.'));

  const garudaPolicy=resolveAirlinePtpCostPolicy({airlineId:'garuda-citilink',airlineName:'Garuda / Citilink',notes:'PTP all-in termasuk RA/gudang keberangkatan. Garuda disamakan dengan Citilink.',adminPerSmu:20000});
  const batch=calculatePhase1PtpVendorBatchCost({batchWeightKg:12,vendorMinKg:10,airlineRatePerKg:70225,policy:garudaPolicy});
  checks.push(assert('GARUDA_RA_INCLUDED',component({components:batch.components},'CGK_RA')?.amount===0,'RA terpisah = Rp0 karena termasuk PTP airline.'));
  checks.push(assert('GARUDA_WAREHOUSE_INCLUDED',component({components:batch.components},'CGK_WAREHOUSE_HANDLING')?.amount===0,'Gudang keberangkatan terpisah = Rp0 karena termasuk PTP airline.'));
  checks.push(assert('AIRLINE_ADMIN_REPLACES_GENERIC_SMU',component({components:batch.components},'CGK_SMU_HANDLING')?.amount===0&&component({components:batch.components},'AIRLINE_ADMIN_SMU')?.amount===20000,'Admin airline Rp20.000/SMU menggantikan generic CGK SMU handling.'));
  checks.push(assert('GARUDA_BATCH_TOTAL',batch.total===862700,'12 kg × Rp70.225 + Rp20.000 admin = Rp862.700 tanpa RA/gudang dobel.'));

  const allocated=allocateOperationalCosts([
    {bookingId:'TEST-A',hubCode:'CGK',chargeableWeightKg:3,smuNumber:'SMU-PHASE1-TEST',isLastmileIncoming:true,airlinePtpPolicy:garudaPolicy},
    {bookingId:'TEST-B',hubCode:'CGK',chargeableWeightKg:7,smuNumber:'SMU-PHASE1-TEST',isLastmileIncoming:true,airlinePtpPolicy:garudaPolicy},
  ]);
  const adminTotal=allocated.bookings.reduce((s,b)=>s+Number(component(b,'AIRLINE_ADMIN_SMU')?.amount||0),0);
  const incomingTotal=allocated.bookings.reduce((s,b)=>s+Number(component(b,'LASTMILE_HANDLING_BARANG')?.amount||0),0);
  const raTotal=allocated.bookings.reduce((s,b)=>s+Number(component(b,'CGK_RA')?.amount||0),0);
  const whTotal=allocated.bookings.reduce((s,b)=>s+Number(component(b,'CGK_WAREHOUSE_HANDLING')?.amount||0),0);
  const genericSmuTotal=allocated.bookings.reduce((s,b)=>s+Number(component(b,'CGK_SMU_HANDLING')?.amount||0),0);
  checks.push(assert('UNIQUE_SMU_AIRLINE_ADMIN',adminTotal===20000,`Satu SMU dua booking tetap admin airline total Rp${adminTotal.toLocaleString('id-ID')}.`));
  checks.push(assert('UNIQUE_SMU_INCOMING_HANDLING',incomingTotal===25000,`Satu SMU dua booking tetap handling incoming total Rp${incomingTotal.toLocaleString('id-ID')}.`));
  checks.push(assert('NO_GENERIC_CGK_DUPLICATE',raTotal===0&&whTotal===0&&genericSmuTotal===0,'RA, gudang dan generic SMU tidak muncul lagi di atas PTP Garuda all-in.'));

  return {ok:true,status:'PASS',checkCount:checks.length,checks,example:{regular3Kg:3,ons3Kg:10,garuda12KgVendorCost:batch.total,uniqueSmuAirlineAdmin:adminTotal,uniqueSmuIncomingHandling:incomingTotal},testedAt:new Date().toISOString()};
}
