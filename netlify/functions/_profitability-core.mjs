import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking, listBookings } from './_booking-core.mjs';
import { getManifest } from './_manifest-core.mjs';
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
  const [bookings,costs]=await Promise.all([listBookings(Math.min(Number(limit)||1000,2000)),listVendorCosts(2000)]),costByBooking=new Map();
  for(const c of costs)for(const a of c.allocations||[])costByBooking.set(a.bookingId,(costByBooking.get(a.bookingId)||0)+money(a.amount));
  const rows=await Promise.all(bookings.map(async b=>{
    const expected=await getOrCreateExpectedCostSnapshot(b),revenue=money(b.amount),expectedVendorCost=money(expected?.total),actualCostRecorded=costByBooking.has(b.bookingId),vendorCost=money(costByBooking.get(b.bookingId)),expectedGrossProfit=revenue-expectedVendorCost,expectedMarginPct=revenue>0?Math.round(expectedGrossProfit/revenue*10000)/100:null,grossProfit=actualCostRecorded?revenue-vendorCost:null,marginPct=actualCostRecorded&&revenue>0?Math.round(grossProfit/revenue*10000)/100:null,costVariance=actualCostRecorded?vendorCost-expectedVendorCost:null;
    return {bookingId:b.bookingId,partnerId:b.partnerId||null,routeCode:b.kodeRute||null,status:b.status,revenue,expectedVendorCost,vendorCost,actualCostRecorded,costVariance,grossProfit,expectedGrossProfit,marginPct,expectedMarginPct,vendorSnapshotVersion:expected?.snapshotVersion||null,expectedCostSource:expected?.source||null,createdAt:b.createdAt};
  }));
  const routeMap=new Map();
  for(const r of rows){const key=r.routeCode||'UNSPECIFIED',x=routeMap.get(key)||{routeCode:key,bookingCount:0,actualCostBookingCount:0,revenue:0,actualRevenue:0,expectedVendorCost:0,vendorCost:0,costVariance:0,expectedGrossProfit:0,grossProfit:0};x.bookingCount++;x.revenue+=r.revenue;x.expectedVendorCost+=r.expectedVendorCost;x.expectedGrossProfit+=r.expectedGrossProfit;if(r.actualCostRecorded){x.actualCostBookingCount++;x.actualRevenue+=r.revenue;x.vendorCost+=r.vendorCost;x.costVariance+=r.costVariance||0;x.grossProfit+=r.grossProfit||0;}routeMap.set(key,x);}
  const routes=[...routeMap.values()].map(x=>({...x,expectedMarginPct:x.revenue>0?Math.round(x.expectedGrossProfit/x.revenue*10000)/100:null,marginPct:x.actualRevenue>0?Math.round(x.grossProfit/x.actualRevenue*10000)/100:null})).sort((a,b)=>b.revenue-a.revenue);
  const summary=rows.reduce((s,r)=>{s.bookingCount++;s.revenue+=r.revenue;s.expectedVendorCost+=r.expectedVendorCost;s.expectedGrossProfit+=r.expectedGrossProfit;if(r.actualCostRecorded){s.actualCostBookingCount++;s.actualRevenue+=r.revenue;s.vendorCost+=r.vendorCost;s.costVariance+=r.costVariance||0;s.grossProfit+=r.grossProfit||0;}return s;},{bookingCount:0,actualCostBookingCount:0,revenue:0,actualRevenue:0,expectedVendorCost:0,vendorCost:0,costVariance:0,expectedGrossProfit:0,grossProfit:0});
  summary.expectedMarginPct=summary.revenue>0?Math.round(summary.expectedGrossProfit/summary.revenue*10000)/100:null;summary.marginPct=summary.actualRevenue>0?Math.round(summary.grossProfit/summary.actualRevenue*10000)/100:null;
  return {summary,rows:rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))),routes,costs};
}
