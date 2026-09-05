import { allocateOperationalCosts } from './_smu-cost-allocation-core.mjs';
import { calculatePhase1PtpVendorBatchCost, phase1CustomerChargeableKg, resolveAirlinePtpCostPolicy } from './_phase1-ptd-core.mjs';
import { DJJ_LASTMILE_ENGINE, isDjjLastmileRoute, resolveDjjLastmileWeightBasis } from './_djj-lastmile-engine.mjs';
import { allocateFinanceIncomingHandling } from './_finance-smu-handling-core.mjs';
import { simulatePhase1PtpSelling } from './_phase1-final-pricing-core.mjs';
import { calculateRateAmount } from './_rate-plan-core.mjs';

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

  const marginSim=simulatePhase1PtpSelling({airlineRatePerKg:70225,customerChargeableKg:10,lastmileRatePerKg:7000,insuranceAmount:0,roundTo:1000,margins:[5,10,15,20]});
  const m5=marginSim.find(x=>x.marginPct===5),m10=marginSim.find(x=>x.marginPct===10),m15=marginSim.find(x=>x.marginPct===15),m20=marginSim.find(x=>x.marginPct===20);
  checks.push(assert('PTP_MARGIN_SIM_ROUNDING',m5?.ptpSellRatePerKg===74000&&m10?.ptpSellRatePerKg===78000&&m15?.ptpSellRatePerKg===81000&&m20?.ptpSellRatePerKg===85000,'Rate simulasi 5/10/15/20% dibulatkan ke Rp74k/Rp78k/Rp81k/Rp85k per kg sesuai roundTo Rp1.000.'));
  checks.push(assert('PTP_MARGIN_SIM_NO_HIDDEN_SMU',m10?.ptpFreight===780000&&m10?.totalPreview===850000,'Simulasi 10 kg @10% menghasilkan PTP Rp780.000 + last-mile Rp70.000 tanpa admin/SMU disisipkan penuh per booking.'));

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

  checks.push(assert('DJJ_LASTMILE_ROUTE_ONLY',isDjjLastmileRoute({hub:'DJJ',moda:'DARAT'})&&!isDjjLastmileRoute({hub:'WMX',moda:'DARAT'}),'Shared last-mile engine menerima Hub DJJ/Sentani dan menolak hub non-DJJ.'));
  const apiBasis=resolveDjjLastmileWeightBasis({smuTotalWeightKg:12.4,weightKg:9.2},'PARTNER_API');
  checks.push(assert('PARTNER_API_PTI_WEIGHT_LOCK',apiBasis.weightBasis==='PARTNER_PTI'&&apiBasis.basisWeightKg===12.4&&apiBasis.sentaniPhysicalCheckMayRepriceCustomer===false,'Partner API tetap memakai berat PTI partner; cek fisik Sentani tidak mereprice customer.'));
  const jlxBasis=resolveDjjLastmileWeightBasis({chargeableWeightKg:8.6,weightKg:6.1},'JLX_INTERNAL');
  checks.push(assert('JLX_ARRIVAL_WEIGHT_LOCK',jlxBasis.weightBasis==='JLX_UPSTREAM_FINAL_ARRIVAL'&&jlxBasis.basisWeightKg===8.6&&jlxBasis.sentaniPhysicalCheckMayRepriceCustomer===false,'JL Express last-mile memakai final upstream/arrival; Sentani tidak mengubah billing airfreight.'));
  const lastmileQuote=calculateRateAmount({ratePerKg:7000,minimumChargeKg:0,fixedFee:0,handlingFee:0,surchargePct:0,cutoffWit:'14:00'},5);
  checks.push(assert('LASTMILE_ROUTE_NO_HIDDEN_25K',lastmileQuote?.handlingFee===0&&lastmileQuote?.totalAmount===35000,'Tarif rute 5 kg × Rp7.000 = Rp35.000 tanpa Rp25.000 incoming disisipkan per booking.'));
  checks.push(assert('DJJ_ENGINE_NO_SENTANI_REPRICE',DJJ_LASTMILE_ENGINE.billingPolicy.sentaniPhysicalCheckMayRepriceCustomer===false,'DJJ_LASTMILE_V1 mengunci Sentani physical check sebagai audit/incident evidence, bukan sumber repricing customer.'));

  const sharedFinanceMap=new Map([
    ['ROUTE-SENTANI',{smuNumber:'SMU-SHARED-FIN',smuNumbers:['SMU-SHARED-FIN']}],
    ['ROUTE-WAENA',{smuNumber:'SMU-SHARED-FIN',smuNumbers:['SMU-SHARED-FIN']}],
  ]);
  const financeShared=allocateFinanceIncomingHandling([
    {bookingId:'ROUTE-SENTANI',serviceType:'PTD',requiresLastmile:true,chargeableWeightKg:4},
    {bookingId:'ROUTE-WAENA',serviceType:'PTD',requiresLastmile:true,chargeableWeightKg:6},
  ],sharedFinanceMap);
  checks.push(assert('FINANCE_GLOBAL_UNIQUE_SMU',financeShared.smuCount===1&&financeShared.total===25000,'Shared SMU lintas dua rute tetap total handling Finance Rp25.000.'));
  checks.push(assert('FINANCE_GLOBAL_ALLOCATION_SUM',Number(financeShared.bookingMap.get('ROUTE-SENTANI')||0)+Number(financeShared.bookingMap.get('ROUTE-WAENA')||0)===25000,'Alokasi dua rute dijumlahkan kembali tepat Rp25.000, tidak dobel.'));
  const multiSmu=allocateFinanceIncomingHandling([{bookingId:'MULTI-SMU',serviceType:'PTD',requiresLastmile:true,chargeableWeightKg:10}],new Map([['MULTI-SMU',{smuNumbers:['SMU-A','SMU-B']}]]));
  checks.push(assert('FINANCE_MULTI_SMU_COUNT',multiSmu.smuCount===2&&multiSmu.total===50000&&Number(multiSmu.bookingMap.get('MULTI-SMU'))===50000,'Satu booking dengan dua SMU menghitung 2 × Rp25.000 = Rp50.000.'));
  const ptpOnly=allocateFinanceIncomingHandling([{bookingId:'PTP-ONLY',serviceType:'PTP',requiresLastmile:false,chargeableWeightKg:20}],new Map([['PTP-ONLY',{smuNumbers:['SMU-PTP']}]]));
  checks.push(assert('FINANCE_PTP_EXCLUDED',ptpOnly.smuCount===0&&ptpOnly.total===0,'Booking PTP-only tidak terkena handling incoming last-mile.'));

  return {ok:true,status:'PASS',checkCount:checks.length,checks,example:{regular3Kg:3,ons3Kg:10,garuda12KgVendorCost:batch.total,ptpSell10PctPerKg:m10?.ptpSellRatePerKg||0,uniqueSmuAirlineAdmin:adminTotal,uniqueSmuIncomingHandling:incomingTotal,partnerPtiWeightKg:apiBasis.basisWeightKg,jlxArrivalWeightKg:jlxBasis.basisWeightKg,lastmile5KgRouteOnly:lastmileQuote?.totalAmount||0,financeSharedSmuTotal:financeShared.total},testedAt:new Date().toISOString()};
}
