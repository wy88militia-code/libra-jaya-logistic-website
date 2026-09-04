import { getStore } from '@netlify/blobs';
import { listBookings, updateBooking } from './_booking-core.mjs';
import { getMasterSnapshot } from './_master-sheet-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { mutateWallet } from './_partner-core.mjs';
import { getQuote } from './_quote-core.mjs';

const STORE='libra-consolidation';
const store=()=>getStore(STORE);
const now=()=>new Date().toISOString();
const DEFAULT_CUTOFF='14:00';
const ACTIVE_FOR_CONSOLIDATION=new Set(['BOOKED','PICKUP_ASSIGNED','PICKED_UP','AT_ORIGIN_HUB','MIN_LOAD_TOPUP_REQUIRED']);

function cutoffParts(value){const m=String(value||DEFAULT_CUTOFF).match(/^(\d{1,2}):(\d{2})/);if(!m)return {h:14,m:0};return {h:Number(m[1]),m:Number(m[2])};}
function witParts(value){const d=new Date(value);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const get=t=>parts.find(p=>p.type===t)?.value;return {year:Number(get('year')),month:Number(get('month')),day:Number(get('day')),hour:Number(get('hour')),minute:Number(get('minute'))};}
function dateKey(parts){return `${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}`;}
function nextDateKey(parts){const d=new Date(Date.UTC(parts.year,parts.month-1,parts.day)+86400000);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;}
function serviceDateFor(value,cutoff){const p=witParts(value),c=cutoffParts(cutoff),after=p.hour>c.h||(p.hour===c.h&&p.minute>=c.m);return after?nextDateKey(p):dateKey(p);}
function todayWit(){return dateKey(witParts(new Date()));}
function currentWitMinutes(){const p=witParts(new Date());return p.hour*60+p.minute;}
function cutoffMinutes(value){const c=cutoffParts(value);return c.h*60+c.m;}
function batchKey(serviceDate,kodeRute){return `batch/${serviceDate}/${String(kodeRute||'').trim()}`;}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function roundMoney(v){return Math.max(0,Math.round(num(v)));}

async function groupRecentBookings(){
  const snapshot=await getMasterSnapshot();if(!snapshot?.routes?.length)return {snapshot:null,groups:new Map()};
  const routeMap=new Map(snapshot.routes.map(r=>[r.kodeRute,r])),bookings=await listBookings(2000),groups=new Map(),today=todayWit();
  for(const booking of bookings){
    if(!ACTIVE_FOR_CONSOLIDATION.has(String(booking.status||'').toUpperCase()))continue;
    const route=routeMap.get(booking.kodeRute);if(!route||num(route.minimumLoadKg)<=0||route.coverageStatus!=='ACTIVE')continue;
    const quote=booking.quoteId?await getQuote(booking.quoteId):null,cutoff=quote?.cutoffWit||route.cutoffWit||DEFAULT_CUTOFF,serviceDate=booking.serviceDate||serviceDateFor(booking.bookedAt||booking.createdAt,cutoff);
    if(serviceDate>today)continue;if(serviceDate===today&&currentWitMinutes()<cutoffMinutes(cutoff))continue;
    const key=`${serviceDate}|${booking.kodeRute}`,entry=groups.get(key)||{serviceDate,kodeRute:booking.kodeRute,cutoffWit:cutoff,route,items:[]};
    entry.items.push({booking,quote});groups.set(key,entry);
  }
  return {snapshot,groups};
}
function allocateGap(items,gap){
  const totalWeight=items.reduce((s,x)=>s+x.chargeableKg,0);if(gap<=0||totalWeight<=0)return items.map(x=>({...x,adjustment:0}));
  let allocated=0;const rows=items.map((x,i)=>{const adjustment=i===items.length-1?gap-allocated:Math.round(gap*x.chargeableKg/totalWeight);allocated+=adjustment;return {...x,adjustment:Math.max(0,adjustment)};});return rows;
}
async function processGroup(group){
  const existing=await store().get(batchKey(group.serviceDate,group.kodeRute),{type:'json',consistency:'strong'});if(existing?.status==='FINALIZED')return {...existing,idempotent:true};
  const route=group.route,minLoadKg=num(route.minimumLoadKg),targetRevenue=roundMoney(route.omzetMinTarget||num(route.tarifRekomKg)*minLoadKg),items=group.items.map(({booking,quote})=>({booking,quote,chargeableKg:Math.max(0,num(booking.chargeableWeightKg||quote?.chargeableKg||booking.weightKg)),baseAmount:roundMoney(booking.minimumLoadAdjustment?.baseAmount||booking.amount)})).filter(x=>x.chargeableKg>0&&x.baseAmount>0);
  const totalWeightKg=items.reduce((s,x)=>s+x.chargeableKg,0),baseRevenue=items.reduce((s,x)=>s+x.baseAmount,0),deficitKg=Math.max(0,minLoadKg-totalWeightKg),gapRevenue=deficitKg>0?Math.max(0,targetRevenue-baseRevenue):0,allocated=allocateGap(items,gapRevenue);
  const results=[];let paymentPending=false;
  for(const row of allocated){
    const b=row.booking,base=row.baseAmount,adjustment=row.adjustment,common={serviceDate:group.serviceDate,kodeRute:group.kodeRute,minimumLoadKg:minLoadKg,totalConsolidatedKg:totalWeightKg,deficitKg,targetRevenue,baseAmount:base,adjustmentAmount:adjustment,finalAmount:base+adjustment,calculatedAt:now()};
    if(adjustment<=0){const updated=await updateBooking(b.bookingId,{serviceDate:group.serviceDate,minimumLoadAdjustment:{...common,status:'CLEARED_NO_SURCHARGE'},minimumLoadStatus:'CLEARED'}).catch(()=>null);results.push({bookingId:b.bookingId,partnerId:b.partnerId,adjustment:0,status:'CLEARED',updated:Boolean(updated)});continue;}
    try{
      const wallet=await mutateWallet(b.partnerId,-adjustment,`MINLOAD:${group.serviceDate}:${group.kodeRute}:${b.bookingId}`,{source:'MINIMUM_LOAD_ADJUSTMENT',description:`Prorata minimum load ${group.kodeRute} ${group.serviceDate}`,metadata:{bookingId:b.bookingId,kodeRute:group.kodeRute,serviceDate:group.serviceDate,minLoadKg,totalWeightKg,deficitKg,targetRevenue}});
      await updateBooking(b.bookingId,{serviceDate:group.serviceDate,baseAmount:base,amount:base+adjustment,minimumLoadAdjustment:{...common,status:'CHARGED',transactionId:wallet.transactionId,chargedAt:now()},minimumLoadStatus:'CLEARED'});
      results.push({bookingId:b.bookingId,partnerId:b.partnerId,adjustment,status:'CHARGED',transactionId:wallet.transactionId});
      try{await createOperationalNotification({partnerId:b.partnerId,type:'MINIMUM_LOAD_ADJUSTMENT',severity:'WARNING',title:'Penyesuaian minimum load',message:`Booking ${b.bookingId} mendapat penyesuaian Rp${adjustment.toLocaleString('id-ID')} karena konsolidasi rute ${group.kodeRute} hanya ${totalWeightKg} kg dari minimum ${minLoadKg} kg pada cut-off.`,reference:b.bookingId,partnerLink:'/partner/history.html',adminLink:'/admin-bookings',dedupeKey:`minload:${group.serviceDate}:${b.bookingId}`,metadata:{bookingId:b.bookingId,kodeRute:group.kodeRute,serviceDate:group.serviceDate,adjustment,totalWeightKg,minLoadKg,deficitKg}});}catch{}
    }catch(error){paymentPending=true;await updateBooking(b.bookingId,{serviceDate:group.serviceDate,status:'MIN_LOAD_TOPUP_REQUIRED',minimumLoadAdjustment:{...common,status:'TOPUP_REQUIRED',error:String(error?.message||error).slice(0,240)},minimumLoadStatus:'TOPUP_REQUIRED'}).catch(()=>{});results.push({bookingId:b.bookingId,partnerId:b.partnerId,adjustment,status:'TOPUP_REQUIRED',error:String(error?.message||error)});try{await createOperationalNotification({partnerId:b.partnerId,type:'MINIMUM_LOAD_TOPUP_REQUIRED',severity:'CRITICAL',title:'Top-up diperlukan sebelum keberangkatan',message:`Booking ${b.bookingId} membutuhkan tambahan Rp${adjustment.toLocaleString('id-ID')} untuk memenuhi minimum load rute ${group.kodeRute}.`,reference:b.bookingId,partnerLink:'/partner/wallet.html',adminLink:'/admin-bookings',dedupeKey:`minload-topup:${group.serviceDate}:${b.bookingId}`,metadata:{bookingId:b.bookingId,kodeRute:group.kodeRute,serviceDate:group.serviceDate,adjustment,totalWeightKg,minLoadKg}});}catch{}}
  }
  const record={batchId:`${group.serviceDate}:${group.kodeRute}`,serviceDate:group.serviceDate,kodeRute:group.kodeRute,cutoffWit:group.cutoffWit,minimumLoadKg:minLoadKg,totalConsolidatedKg:totalWeightKg,deficitKg,targetRevenue,baseRevenue,gapRevenue,bookingCount:items.length,status:paymentPending?'PAYMENT_PENDING':'FINALIZED',results,processedAt:now()};
  await store().setJSON(batchKey(group.serviceDate,group.kodeRute),record);return record;
}

export async function runMinimumLoadConsolidation(){
  const {groups}=await groupRecentBookings(),results=[];for(const group of groups.values()){try{results.push(await processGroup(group));}catch(error){results.push({serviceDate:group.serviceDate,kodeRute:group.kodeRute,status:'ERROR',error:String(error?.message||error)});}}
  return {runAt:now(),groups:results.length,finalized:results.filter(r=>r.status==='FINALIZED').length,pending:results.filter(r=>r.status==='PAYMENT_PENDING').length,errors:results.filter(r=>r.status==='ERROR').length,results};
}
export async function listConsolidationBatches(limit=100){const {blobs}=await store().list({prefix:'batch/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(Number(limit)||100,500))),rows=[];for(const blob of selected){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;}
