import { listBookings } from './_booking-core.mjs';
import { getMasterSnapshot } from './_master-sheet-core.mjs';
import { bookingSmuMap, INCOMING_HANDLING_PER_SMU } from './_smu-core.mjs';

const VEHICLE_CAPACITY_KG=805;
const TARGET_MARGIN=0.35;
const blocked=new Set(['UAT_VALIDATED','CANCELLED','VOID','REFUNDED']);
const money=v=>Math.round(Number(v)||0);
const kg=v=>Math.round((Number(v)||0)*100)/100;
function witDate(v=new Date()){const d=new Date(v);if(!Number.isFinite(d.getTime()))return '';const x=new Date(d.getTime()+9*3600000);return `${x.getUTCFullYear()}-${String(x.getUTCMonth()+1).padStart(2,'0')}-${String(x.getUTCDate()).padStart(2,'0')}`;}
function witMonth(v=new Date()){return witDate(v).slice(0,7);}
function paidBooking(b){return b&&b.source!=='API_UAT'&&!blocked.has(String(b.status||'').toUpperCase())&&Number(b.amount)>0&&Boolean(b.bookedAt||b.transactionId);}
function routeCostHasHandling(route){return /HANDLING\s+INCOMING.*SMU|25\.000\/SMU/i.test(String(route?.catatanModal||''));}
function routeStatus({costKnown,revenue,cost,loadPct}){if(!costKnown)return 'UNKNOWN';if(revenue>=cost&&loadPct>=1)return 'GREEN';const pct=cost>0?revenue/cost:0;if(revenue>=cost||pct>=0.9)return 'YELLOW';return 'RED';}

export async function buildDailyFinancePerformance(at=new Date()){
  const date=witDate(at),month=witMonth(at);const [bookings,master,smuMap]=await Promise.all([listBookings(2000),getMasterSnapshot(),bookingSmuMap()]);
  const recognized=bookings.filter(paidBooking),today=recognized.filter(b=>witDate(b.bookedAt||b.createdAt)===date),mtd=recognized.filter(b=>witMonth(b.bookedAt||b.createdAt)===month);const routeMap=new Map((master?.routes||[]).map(r=>[String(r.kodeRute||''),r]));
  const grouped=new Map();
  for(const b of today){const code=String(b.kodeRute||'UNSPECIFIED'),x=grouped.get(code)||{kodeRute:code,bookings:[],revenue:0,weightKg:0,smu:new Set()};x.bookings.push(b);x.revenue+=money(b.amount);x.weightKg+=Number(b.chargeableWeightKg||b.weightKg||0);const assigned=smuMap.get(b.bookingId)?.smuNumber;x.smu.add(assigned||`BOOKING:${b.bookingId}`);grouped.set(code,x);}
  const routes=[];
  for(const x of grouped.values()){
    const route=routeMap.get(x.kodeRute)||null,minimumLoadKg=Number(route?.minimumLoadKg||route?.minimumLoadDepartureKg||0),estimatedTrips=Math.max(1,Math.ceil(Math.max(0,x.weightKg)/VEHICLE_CAPACITY_KG)),modelFullCost=Number(route?.fullCostTrip||0),modelHasHandling=routeCostHasHandling(route),baseTripCost=modelFullCost>0?Math.max(0,modelFullCost-(modelHasHandling?INCOMING_HANDLING_PER_SMU:0)):0,smuCount=x.smu.size,handlingIncoming=smuCount*INCOMING_HANDLING_PER_SMU,costKnown=modelFullCost>0,totalCost=costKnown?money(baseTripCost*estimatedTrips+handlingIncoming):0,bepGap=costKnown?money(x.revenue-totalCost):null,bepPct=costKnown&&totalCost>0?Math.round(x.revenue/totalCost*1000)/10:null,grossProfit=bepGap,marginPct=x.revenue>0&&grossProfit!==null?Math.round(grossProfit/x.revenue*10000)/100:null,targetRevenue=costKnown?money(totalCost/(1-TARGET_MARGIN)):0,targetMarginGap=costKnown?money(x.revenue-targetRevenue):null,loadTargetKg=minimumLoadKg>0?minimumLoadKg*estimatedTrips:0,loadPct=loadTargetKg>0?Math.round(x.weightKg/loadTargetKg*1000)/10:100,status=routeStatus({costKnown,revenue:x.revenue,cost:totalCost,loadPct});
    routes.push({kodeRute:x.kodeRute,tujuan:route?.kelurahan||x.bookings[0]?.destination?.kelurahan||'—',bookingCount:x.bookings.length,weightKg:kg(x.weightKg),smuCount,handlingIncoming,estimatedTrips,minimumLoadKg,loadTargetKg,loadPct,revenue:money(x.revenue),modelFullCostTrip:money(modelFullCost),estimatedCost:totalCost,bepGap,bepPct,grossProfit,marginPct,targetRevenue,targetMarginGap,status,costKnown,smuAssignedCount:x.bookings.filter(b=>smuMap.get(b.bookingId)?.smuNumber).length});
  }
  routes.sort((a,b)=>b.revenue-a.revenue);
  const total={date,month,revenue:today.reduce((s,b)=>s+money(b.amount),0),mtdRevenue:mtd.reduce((s,b)=>s+money(b.amount),0),bookingCount:today.length,weightKg:kg(today.reduce((s,b)=>s+Number(b.chargeableWeightKg||b.weightKg||0),0)),smuCount:routes.reduce((s,r)=>s+r.smuCount,0),handlingIncoming:routes.reduce((s,r)=>s+r.handlingIncoming,0),estimatedCost:routes.reduce((s,r)=>s+(r.costKnown?r.estimatedCost:0),0),unknownCostRoutes:routes.filter(r=>!r.costKnown).length,green:routes.filter(r=>r.status==='GREEN').length,yellow:routes.filter(r=>r.status==='YELLOW').length,red:routes.filter(r=>r.status==='RED').length,unknown:routes.filter(r=>r.status==='UNKNOWN').length};
  total.bepGap=total.unknownCostRoutes?null:money(total.revenue-total.estimatedCost);total.bepPct=!total.unknownCostRoutes&&total.estimatedCost>0?Math.round(total.revenue/total.estimatedCost*1000)/10:null;total.grossProfit=total.bepGap;total.marginPct=total.revenue>0&&total.grossProfit!==null?Math.round(total.grossProfit/total.revenue*10000)/100:null;total.targetRevenue=!total.unknownCostRoutes?money(total.estimatedCost/(1-TARGET_MARGIN)):null;total.targetMarginGap=total.targetRevenue!==null?money(total.revenue-total.targetRevenue):null;total.status=today.length===0?'NO_ACTIVITY':total.unknownCostRoutes?'INCOMPLETE':total.revenue>=total.estimatedCost?'BEP_REACHED':total.bepPct>=90?'NEAR_BEP':'BELOW_BEP';
  return {generatedAt:new Date().toISOString(),date,assumptions:{incomingHandlingPerUniqueSmu:INCOMING_HANDLING_PER_SMU,vehicleCapacityKg:VEHICLE_CAPACITY_KG,targetGrossMarginPct:TARGET_MARGIN*100,smuRule:'Nomor SMU yang sama pada beberapa booking dihitung 1 SMU gabungan. Booking tanpa nomor SMU sementara dihitung 1 SMU sendiri.'},total,routes};
}
