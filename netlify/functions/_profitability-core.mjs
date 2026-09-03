import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getBooking, listBookings } from './_booking-core.mjs';
import { getManifest } from './_manifest-core.mjs';

const STORE='libra-profitability';
const store=()=>getStore(STORE);
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const money=v=>Math.trunc(Number(v)||0);
const now=()=>new Date().toISOString();
const CATEGORIES=new Set(['AIRLINE','TRUCKING','SEA_FREIGHT','LAST_MILE','PICKUP','HANDLING','WAREHOUSE','PACKING','INSURANCE','OTHER']);
const costKey=(t,id)=>`cost/${t}-${id}`;
const invoiceKey=(vendor,invoice)=>`invoice/${crypto.createHash('sha256').update(`${vendor}|${invoice}`.toUpperCase()).digest('hex')}`;

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
  const id=`CST-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;const createdAt=now();
  if(invoiceReference){const reserved=await store().set(invoiceKey(vendorName,invoiceReference),id,{onlyIfNew:true});if(!reserved.modified)throw new Error('Invoice/reference vendor sudah pernah dicatat.');}
  const row={costId:id,vendorName,category,amount,currency:'IDR',bookingId,manifestId,invoiceReference,serviceDate:clean(input.serviceDate,20)||null,note:clean(input.note,800)||null,allocations,status:'RECORDED',createdAt,createdBy:clean(actor,100)};
  await store().setJSON(costKey(createdAt,id),row,{onlyIfNew:true});return row;
}

export async function listVendorCosts(limit=500){const {blobs}=await store().list({prefix:'cost/'}),rows=[];for(const b of blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.min(Number(limit)||500,2000))){const r=await store().get(b.key,{type:'json'});if(r)rows.push(r);}return rows;}

export async function buildProfitability(limit=1000){
  const [bookings,costs]=await Promise.all([listBookings(Math.min(Number(limit)||1000,2000)),listVendorCosts(2000)]);const costByBooking=new Map();
  for(const c of costs)for(const a of c.allocations||[])costByBooking.set(a.bookingId,(costByBooking.get(a.bookingId)||0)+money(a.amount));
  const rows=bookings.map(b=>{const revenue=money(b.amount),vendorCost=money(costByBooking.get(b.bookingId)),grossProfit=revenue-vendorCost,marginPct=revenue>0?Math.round(grossProfit/revenue*10000)/100:null;return {bookingId:b.bookingId,partnerId:b.partnerId||null,routeCode:b.kodeRute||null,status:b.status,revenue,vendorCost,grossProfit,marginPct,createdAt:b.createdAt};});
  const routeMap=new Map();for(const r of rows){const key=r.routeCode||'UNSPECIFIED';const x=routeMap.get(key)||{routeCode:key,bookingCount:0,revenue:0,vendorCost:0,grossProfit:0};x.bookingCount++;x.revenue+=r.revenue;x.vendorCost+=r.vendorCost;x.grossProfit+=r.grossProfit;routeMap.set(key,x);}const routes=[...routeMap.values()].map(x=>({...x,marginPct:x.revenue>0?Math.round(x.grossProfit/x.revenue*10000)/100:null})).sort((a,b)=>b.revenue-a.revenue);
  const summary=rows.reduce((s,r)=>({bookingCount:s.bookingCount+1,revenue:s.revenue+r.revenue,vendorCost:s.vendorCost+r.vendorCost,grossProfit:s.grossProfit+r.grossProfit}),{bookingCount:0,revenue:0,vendorCost:0,grossProfit:0});summary.marginPct=summary.revenue>0?Math.round(summary.grossProfit/summary.revenue*10000)/100:null;
  return {summary,rows:rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))),routes,costs};
}
