import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking, listBookings } from './_booking-core.mjs';
import { getManifest } from './_manifest-core.mjs';
import { getPhase1ProfitabilityAllocationMap, phase1CostForBooking } from './_phase1-profitability-bridge-core.mjs';
import { estimateVendorCostForBooking } from './_vendor-master-core.mjs';

const STORE='libra-profitability';
const store=()=>getStore(STORE);
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const money=v=>Math.trunc(Number(v)||0);
const now=()=>new Date().toISOString();
const CATEGORIES=new Set(['AIRLINE','TRUCKING','SEA_FREIGHT','LAST_MILE','PICKUP','HANDLING','WAREHOUSE','PACKING','INSURANCE','OTHER']);
const costKey=(t,id)=>`cost/${t}-${id}`;
const invoiceKey=(vendor,invoice)=>`invoice/${crypto.createHash('sha256').update(`${vendor}|${invoice}`.toUpperCase()).digest('hex')}`;
const expectedKey=bookingId=>`expected/${clean(bookingId,120)}`;

function allocate(total,items){
  const rows=items.map(i=>({bookingId:i.bookingId,weightKg:Number(i.chargeableWeightKg||i.actualWeightKg||i.declaredWeightKg||0)}));
  const positive=rows.filter(x=>x.weightKg>0);if(!positive.length)throw new Error('Manifest tidak memiliki berat yang dapat dipakai untuk alokasi.');
  const sum=positive.reduce((s,x)=>s+x.weightKg,0);let used=0;
  return positive.map((x,idx)=>{const amount=idx===positive.length-1?total-used:Math.floor(total*x.weightKg/sum);used+=amount;return {...x,amount};});
}
function componentTotal(expected,category){return (expected?.components||[]).filter(x=>String(x?.category||'').toUpperCase()===String(category).toUpperCase()).reduce((s,x)=>s+money(x.totalCost??(Number(x.baseCost||0)+Number(x.surchargeCost||0))),0);}
function expectedCostComposition(expected,p1){
  const rawVendor=money(expected?.total),authoritativeAirline=money(p1?.phase1AirlineCost),suppressedGenericAirline=authoritativeAirline>0?Math.min(rawVendor,componentTotal(expected,'AIRLINE')):0,adjustedVendor=Math.max(0,rawVendor-suppressedGenericAirline),phase1Handling=money(p1?.phase1IncomingHandlingCost),phase1Operational=money(authoritativeAirline+phase1Handling),total=money(adjustedVendor+phase1Operational);
  return {rawVendor,adjustedVendor,suppressedGenericAirline,phase1AirlineCost:authoritativeAirline,phase1IncomingHandlingCost:phase1Handling,phase1OperationalCost:phase1Operational,total};
}

export async function recordVendorCost(input={},actor='finance'){
  const vendorName=clean(input.vendorName,160);if(!vendorName)throw new Error('Nama vendor wajib.');
  const category=String(input.category||'').trim().toUpperCase();if(!CATEGORIES.has(category))throw new Error('Kategori biaya vendor tidak valid.');
  const amount=money(input.amount);if(!(amount>0&&amount<=10000000000))throw new Error('Nominal biaya vendor tidak valid.');
  const bookingId=clean(input.bookingId,120)||null,manifestId=clean(input.manifestId,120)||null;if(!bookingId&&!manifestId)throw new Error('Booking ID atau Manifest ID wajib.');
  const invoiceReference=clean(input.invoiceReference,160)||null;
  let allocations=[];
  if(bookingId){const b=await getBooking(bookingId);if(!b)throw new Error('Booking tidak ditemukan.');if(manifestId){const m=await getManifest(manifestId);if(!m)throw new Error('Manifest tidak ditemukan.');if(!m.items?.[bookingId])throw new Error('Booking tidak terdaftar pada manifest tersebut.');}allocations=[{bookingId,weightKg:Number(b.weightKg||0),amount}];}
  else{const m=await getManifest(manifestId);if(!m)throw new Error('Manifest tidak ditemukan.');allocations=allocate(amount,Object.values(m.items||{}));}
  const id=`CST-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,createdAt=now();
  if(invoiceReference){const reserved=await store().set(invoiceKey(vendorName,invoiceReference),id,{onlyIfNew:true});if(!reserved.modified)throw new Error('Invoice/reference vendor sudah pernah dicatat.');}
  const row={costId:id,vendorName,category,amount,currency:'IDR',bookingId,manifestId,invoiceReference,serviceDate:clean(input.serviceDate,20)||null,note:clean(input.note,800)||null,allocations,status:'RECORDED',createdAt,createdBy:clean(actor,100)};
  await store().setJSON(costKey(createdAt,id),row,{onlyIfNew:true});return row;
}

export async function listVendorCosts(limit=500){const {blobs}=await store().list({prefix:'cost/'}),rows=[];for(const b of blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.min(Number(limit)||500,2000))){const r=await store().get(b.key,{type:'json'});if(r)rows.push(r);}return rows;}

export async function getOrCreateExpectedCostSnapshot(booking={}){
  if(booking.vendorCostSnapshot?.snapshotVersion)return {...booking.vendorCostSnapshot,source:booking.vendorCostSnapshot.source||'BOOKING_CREATION'};
  const key=expectedKey(booking.bookingId),existing=await store().get(key,{type:'json',consistency:'strong'});if(existing)return existing;
  const estimate=await estimateVendorCostForBooking(booking);if(!estimate.snapshotVersion)return {bookingId:booking.bookingId,snapshotVersion:null,total:0,components:[],status:estimate.status||'NO_MASTER',source:'NO_MASTER'};
  const row={bookingId:booking.bookingId,snapshotVersion:estimate.snapshotVersion,total:money(estimate.total),components:estimate.components||[],status:estimate.status||'ESTIMATED',source:'LEGACY_FIRST_EVALUATION',capturedAt:now()};
  const saved=await store().setJSON(key,row,{onlyIfNew:true});if(saved.modified)return row;return store().get(key,{type:'json',consistency:'strong'});
}

export async function buildProfitability(limit=1000){
  const [bookings,costs,phase1Map]=await Promise.all([listBookings(Math.min(Number(limit)||1000,2000)),listVendorCosts(2000),getPhase1ProfitabilityAllocationMap(1000)]),costByBooking=new Map();
  for(const c of costs)for(const a of c.allocations||[])costByBooking.set(a.bookingId,(costByBooking.get(a.bookingId)||0)+money(a.amount));
  const rows=await Promise.all(bookings.map(async b=>{
    const expected=await getOrCreateExpectedCostSnapshot(b),phase1=phase1CostForBooking(phase1Map,b.bookingId),composition=expectedCostComposition(expected,phase1),revenue=money(b.amount),expectedVendorCost=composition.adjustedVendor,expectedCost=composition.total,actualCostRecorded=costByBooking.has(b.bookingId),vendorCost=money(costByBooking.get(b.bookingId)),expectedGrossProfit=revenue-expectedCost,expectedMarginPct=revenue>0?Math.round(expectedGrossProfit/revenue*10000)/100:null,grossProfit=actualCostRecorded?revenue-vendorCost:null,marginPct=actualCostRecorded&&revenue>0?Math.round(grossProfit/revenue*10000)/100:null,costVariance=actualCostRecorded?vendorCost-expectedCost:null;
    return {bookingId:b.bookingId,partnerId:b.partnerId||null,routeCode:b.kodeRute||null,status:b.status,revenue,expectedVendorCostRaw:composition.rawVendor,expectedVendorCost,expectedAirlineSuppressed:composition.suppressedGenericAirline,phase1AirlineCost:composition.phase1AirlineCost,phase1IncomingHandlingCost:composition.phase1IncomingHandlingCost,phase1OperationalCost:composition.phase1OperationalCost,phase1BatchIds:phase1.batchIds||[],phase1SmuNumbers:phase1.smuNumbers||[],expectedCost,vendorCost,actualCostRecorded,costVariance,grossProfit,expectedGrossProfit,marginPct,expectedMarginPct,vendorSnapshotVersion:expected?.snapshotVersion||null,expectedCostSource:expected?.source||null,createdAt:b.createdAt};
  }));
  const routeMap=new Map();
  for(const r of rows){const key=r.routeCode||'UNSPECIFIED',x=routeMap.get(key)||{routeCode:key,bookingCount:0,actualCostBookingCount:0,revenue:0,actualRevenue:0,expectedVendorCostRaw:0,expectedVendorCost:0,expectedAirlineSuppressed:0,phase1AirlineCost:0,phase1IncomingHandlingCost:0,phase1OperationalCost:0,expectedCost:0,vendorCost:0,costVariance:0,expectedGrossProfit:0,grossProfit:0};x.bookingCount++;x.revenue+=r.revenue;x.expectedVendorCostRaw+=r.expectedVendorCostRaw;x.expectedVendorCost+=r.expectedVendorCost;x.expectedAirlineSuppressed+=r.expectedAirlineSuppressed;x.phase1AirlineCost+=r.phase1AirlineCost;x.phase1IncomingHandlingCost+=r.phase1IncomingHandlingCost;x.phase1OperationalCost+=r.phase1OperationalCost;x.expectedCost+=r.expectedCost;x.expectedGrossProfit+=r.expectedGrossProfit;if(r.actualCostRecorded){x.actualCostBookingCount++;x.actualRevenue+=r.revenue;x.vendorCost+=r.vendorCost;x.costVariance+=r.costVariance||0;x.grossProfit+=r.grossProfit||0;}routeMap.set(key,x);}
  const routes=[...routeMap.values()].map(x=>({...x,expectedMarginPct:x.revenue>0?Math.round(x.expectedGrossProfit/x.revenue*10000)/100:null,marginPct:x.actualRevenue>0?Math.round(x.grossProfit/x.actualRevenue*10000)/100:null})).sort((a,b)=>b.revenue-a.revenue);
  const summary=rows.reduce((s,r)=>{s.bookingCount++;s.revenue+=r.revenue;s.expectedVendorCostRaw+=r.expectedVendorCostRaw;s.expectedVendorCost+=r.expectedVendorCost;s.expectedAirlineSuppressed+=r.expectedAirlineSuppressed;s.phase1AirlineCost+=r.phase1AirlineCost;s.phase1IncomingHandlingCost+=r.phase1IncomingHandlingCost;s.phase1OperationalCost+=r.phase1OperationalCost;s.expectedCost+=r.expectedCost;s.expectedGrossProfit+=r.expectedGrossProfit;if(r.actualCostRecorded){s.actualCostBookingCount++;s.actualRevenue+=r.revenue;s.vendorCost+=r.vendorCost;s.costVariance+=r.costVariance||0;s.grossProfit+=r.grossProfit||0;}return s;},{bookingCount:0,actualCostBookingCount:0,revenue:0,actualRevenue:0,expectedVendorCostRaw:0,expectedVendorCost:0,expectedAirlineSuppressed:0,phase1AirlineCost:0,phase1IncomingHandlingCost:0,phase1OperationalCost:0,expectedCost:0,vendorCost:0,costVariance:0,expectedGrossProfit:0,grossProfit:0});
  summary.expectedMarginPct=summary.revenue>0?Math.round(summary.expectedGrossProfit/summary.revenue*10000)/100:null;summary.marginPct=summary.actualRevenue>0?Math.round(summary.grossProfit/summary.actualRevenue*10000)/100:null;
  return {summary,rows:rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))),routes,costs,phase1CostPolicy:{source:'AUTHORITATIVE_BATCH_SNAPSHOT',customerPricingChanged:false,airlineDuplicatePolicy:'PHASE1_BATCH_OVERRIDES_GENERIC_VENDOR_AIRLINE',incomingHandlingPolicy:'UNIQUE_SMU_ALLOCATED_ONCE'}};
}
