import { getBooking } from './_booking-core.mjs';
import { getJlPricingConfigSnapshot, getPhase1CgkDjjRateSnapshot } from './_jl-master-core.mjs';
import { screenKarantina } from './_karantina-core.mjs';
import { getMasterSnapshot } from './_master-sheet-core.mjs';
import { phase1CustomerChargeableKg, resolveAirlinePtpCostPolicy } from './_phase1-ptd-core.mjs';
import { getWeightApprovalState } from './_weight-approval-core.mjs';

const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const money=v=>Math.max(0,Math.round(Number(v)||0));
const kg=v=>Math.max(0,Math.round(Number(v||0)*100)/100);
function roundUp(value,step=1000){const s=Math.max(1,money(step)||1000);return Math.ceil(Math.max(0,Number(value)||0)/s)*s;}
function serviceCode(booking={}){return upper(booking.serviceLevel)==='ONS'||upper(booking.service).includes('ONS')?'PTD_CGK_DJJ_ONS':'PTD_CGK_DJJ_REGULAR';}
function declaredValue(booking={}){return money(booking.declaredValue??booking.goodsValue??booking.invoiceValue??booking.itemValue);}
function karantinaInput(booking={}){const d=booking.destination||{};return {commodity:booking.commodity||'',cargoType:booking.cargoType||'GENERAL',condition:booking.cargoType||'',origin:'Jakarta CGK',originHub:'CGK',destination:[d.kelurahan,d.distrik,d.kabupatenKota,d.provinsi,booking.destinationHub||'DJJ'].filter(Boolean).join(', '),destinationHub:booking.destinationHub||'DJJ'};}
function fallbackKarantinaRisk(commodity=''){return /\b(daging|sapi|kerbau|ayam|telur|susu|madu|ikan|udang|kepiting|lobster|kerang|cumi|gurita|seafood|buah|sayur|tanaman|bunga|anggrek|bibit|benih|umbi|rimpang|kayu|rotan|bambu)\b/i.test(String(commodity||''));}

export function isPhase1JlxInternalBooking(booking={}){
  const source=upper(booking.source),origin=upper(booking.originHub),destination=upper(booking.destinationHub||'DJJ'),channel=upper(booking.lastmileEngine?.channel);
  if(['API','API_UAT','PARTNER_API'].includes(source)||channel==='PARTNER_API')return false;
  if(origin&&origin!=='CGK')return false;
  if(destination&&destination!=='DJJ')return false;
  return upper(booking.serviceType)==='PTD'&&booking.requiresLastmile!==false;
}

export function simulatePhase1PtpSelling(input={}){
  const airlineRatePerKg=money(input.airlineRatePerKg),customerChargeableKg=kg(input.customerChargeableKg),lastmileRatePerKg=money(input.lastmileRatePerKg),insuranceAmount=money(input.insuranceAmount),roundTo=money(input.roundTo)||1000;
  const margins=[...new Set((Array.isArray(input.margins)?input.margins:[5,10,15,20]).map(x=>Math.round(num(x)*100)/100).filter(x=>x>0&&x<=60))].sort((a,b)=>a-b);
  return margins.map(marginPct=>{
    const ptpSellRatePerKg=roundUp(airlineRatePerKg*(1+marginPct/100),roundTo),ptpFreight=money(ptpSellRatePerKg*customerChargeableKg),lastmileFreight=money(lastmileRatePerKg*customerChargeableKg),totalPreview=money(ptpFreight+lastmileFreight+insuranceAmount),ptpSpreadPerKg=money(ptpSellRatePerKg-airlineRatePerKg),ptpSpreadAmount=money(ptpSpreadPerKg*customerChargeableKg),effectiveGrossMarginPct=ptpSellRatePerKg>0?Math.round(((ptpSellRatePerKg-airlineRatePerKg)/ptpSellRatePerKg)*10000)/100:0;
    return {marginPct,ptpSellRatePerKg,ptpSpreadPerKg,ptpSpreadAmount,effectiveGrossMarginPct,ptpFreight,lastmileFreight,insuranceAmount,totalPreview,note:'Simulasi saja. Admin/unique-SMU dan handling incoming tetap cost internal batch, bukan charge penuh per booking.'};
  });
}

export async function getPhase1FinalPricingReadiness(bookingId,input={}){
  const booking=await getBooking(bookingId);if(!booking)throw new Error('Booking tidak ditemukan.');
  if(!isPhase1JlxInternalBooking(booking)){const e=new Error('Pricing readiness CGK→DJJ ini hanya untuk JL Express internal dari Soetta. Partner API hanya memakai DJJ_LASTMILE_V1 dan tidak boleh masuk pricing airfreight CGK-DJJ.');e.code='NOT_PHASE1_JLX_INTERNAL';throw e;}
  const commodity=clean(booking.commodity,800);
  const karantinaPromise=commodity?screenKarantina(karantinaInput(booking)).catch(error=>({ok:false,status:'SCREENING_UNAVAILABLE',requiresReview:false,holdRequired:false,requiresLiveVerify:false,message:String(error?.message||error).slice(0,240),checkedAt:new Date().toISOString()})):Promise.resolve({ok:false,status:'COMMODITY_REQUIRED',requiresReview:false,holdRequired:false,requiresLiveVerify:false,checkedAt:new Date().toISOString()});
  const [approval,config,airline,master,karantina]=await Promise.all([getWeightApprovalState(bookingId),getJlPricingConfigSnapshot(),getPhase1CgkDjjRateSnapshot({airlineId:input.airlineId||booking.airlineId||'garuda-citilink',cargoType:upper(booking.cargoType)==='GENERAL'?'GENERAL':(input.cargoType||'GENERAL')}),getMasterSnapshot(),karantinaPromise]);
  const reasons=[];
  if(!approval.weight)reasons.push({code:'WEIGHT_NOT_VERIFIED',message:'Berat final Soetta belum terverifikasi.'});
  else if(!approval.continuationAllowed)reasons.push({code:approval.status==='REJECTED'?'WEIGHT_REJECTED':'WEIGHT_APPROVAL_REQUIRED',message:approval.status==='REJECTED'?'Customer/partner menolak penyesuaian berat terbaru.':'Selisih berat ≥0,20 kg masih menunggu approval customer/partner.'});
  if(!config.portToPortSellConfigured)reasons.push({code:'PTP_MARGIN_NOT_CONFIGURED',message:config.blockReason||'Margin PTP belum dikonfigurasi.'});
  const route=(master?.routes||[]).find(r=>String(r.kodeRute||'')===String(booking.kodeRute||''))||null;
  if(!route)reasons.push({code:'LASTMILE_ROUTE_NOT_FOUND',message:'Rute last-mile booking tidak ditemukan pada Master aktif.'});
  else if(String(route.coverageStatus||'').toUpperCase()!=='ACTIVE')reasons.push({code:'LASTMILE_ROUTE_NOT_ACTIVE',message:`Rute ${route.kodeRute} belum ACTIVE.`});
  const lastmileRatePerKg=money(route?.tarifRekomKg);
  if(route&&!(lastmileRatePerKg>0))reasons.push({code:'LASTMILE_SELL_RATE_MISSING',message:'Tarif jual last-mile Master belum tersedia.'});
  const value=declaredValue(booking);if(config.insurance.required&&!(value>0))reasons.push({code:'DECLARED_VALUE_REQUIRED',message:'Nilai barang/faktur wajib diisi untuk menghitung asuransi.'});
  const cargo=upper(booking.cargoType||'GENERAL');if(['DG','FRESH','FROZEN','FRAGILE','OTHER'].includes(cargo))reasons.push({code:'SPECIAL_CARGO_REVIEW_REQUIRED',message:`Cargo ${cargo} memerlukan review surcharge/packing/karantina sebelum harga final.`});
  if(!commodity)reasons.push({code:'COMMODITY_REQUIRED_FOR_COMPLIANCE',message:'Isi/commodity wajib diisi sebelum harga final agar DG dan karantina dapat discreening.'});
  else if(karantina.status==='SCREENING_UNAVAILABLE'&&fallbackKarantinaRisk(commodity))reasons.push({code:'KARANTINA_SCREEN_UNAVAILABLE',message:'Komoditas terindikasi karantina tetapi Master JL_KARANTINA sedang tidak dapat diverifikasi. Harga final ditahan sampai screening tersedia.'});
  if(karantina?.holdRequired)reasons.push({code:'KARANTINA_HOLD_REQUIRED',message:`Master Karantina menandai ${karantina.classification||'komoditas'} sebagai restricted/hold. Wajib verifikasi UPT/Admin sebelum harga final.`});
  if(karantina?.requiresLiveVerify)reasons.push({code:'KARANTINA_LIVE_VERIFY_REQUIRED',message:'Rule karantina HIGH/CRITICAL memerlukan verifikasi sumber resmi/UPT terbaru sebelum harga final.'});

  const finalWeightKg=kg(approval.weight?.libraFinalChargeableWeightKg??approval.weight?.chargeableWeightKg),customerChargeableKg=finalWeightKg>0?phase1CustomerChargeableKg(serviceCode(booking),finalWeightKg):0,marginPct=num(config.margins.portToPort),ptpSellRatePerKg=config.portToPortSellConfigured?roundUp(airline.ratePerKg*(1+marginPct/100),config.roundTo):null,ptpFreight=ptpSellRatePerKg?money(ptpSellRatePerKg*customerChargeableKg):null,lastmileFreight=lastmileRatePerKg>0&&customerChargeableKg>0?money(lastmileRatePerKg*customerChargeableKg):null,insuranceAmount=value>0?money(value*num(config.insurance.ratePercent)/100):null;
  const airlinePolicy=resolveAirlinePtpCostPolicy({airlineId:airline.airlineId,airlineName:airline.airlineName,notes:airline.airlineNotes,adminPerSmu:airline.adminPerSmu});
  const simulations=customerChargeableKg>0&&lastmileRatePerKg>0?simulatePhase1PtpSelling({airlineRatePerKg:airline.ratePerKg,customerChargeableKg,lastmileRatePerKg,insuranceAmount,roundTo:config.roundTo,margins:input.simulationMargins}):[];
  const ready=reasons.length===0,total=ready?money(ptpFreight+lastmileFreight+insuranceAmount):null;
  return {
    ready,bookingId:booking.bookingId,serviceCode:serviceCode(booking),serviceLevel:booking.serviceLevel||null,routeCode:booking.kodeRute||null,finalWeightKg,customerChargeableKg,
    selling:{ptpMarginPct:marginPct,ptpSellRatePerKg,lastmileRatePerKg,ptpFreight,lastmileFreight,declaredValue:value||null,insuranceRequired:config.insurance.required,insuranceRatePercent:config.insurance.ratePercent,insuranceAmount,total},
    simulations,
    karantina,
    costReference:{airlineRateId:airline.rateId,airlineId:airline.airlineId,airlineName:airline.airlineName,airlineRatePerKg:airline.ratePerKg,vendorMinKg:airline.minKg,adminPerUniqueSmu:airline.adminPerSmu,airlinePolicy,note:'Rate airline/admin adalah cost reference. Admin/SMU dan handling incoming Rp25.000 adalah cost unique-SMU internal; tidak otomatis ditambahkan penuh per booking customer.'},
    config:{pricingMode:config.pricingMode,requireConfiguredMargin:config.requireConfiguredMargin,roundTo:config.roundTo,source:config.source,capturedAt:config.capturedAt,portToPortSellConfigured:config.portToPortSellConfigured},
    weightApproval:{status:approval.status,continuationAllowed:approval.continuationAllowed,fingerprint:approval.fingerprint||null},reasons,
  };
}
