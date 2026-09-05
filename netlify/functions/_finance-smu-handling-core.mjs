import { allocateOperationalCosts } from './_smu-cost-allocation-core.mjs';

const money=v=>Math.max(0,Math.round(Number(v)||0));
const kg=v=>Math.max(0,Math.round((Number(v)||0)*100)/100);
const clean=(v,n=120)=>String(v??'').trim().slice(0,n);
const upper=v=>String(v??'').trim().toUpperCase();

function isLastmileEligible(booking={}){
  const type=upper(booking.serviceType),service=upper(booking.service);
  if(booking.requiresLastmile===false)return false;
  if(['PTP','DTP'].includes(type))return false;
  if(type===''&&(service.startsWith('PTP_')||service.startsWith('DTP_')))return false;
  if(booking.destination?.portDelivery===true)return false;
  return true;
}
function handlingComponents(row){return (row?.components||[]).filter(x=>x.code==='LASTMILE_HANDLING_BARANG');}

/**
 * Allocate incoming DJJ handling globally across all last-mile bookings in the period.
 * One physical SMU is charged once even when its bookings fan out to multiple
 * last-mile routes. The Rp25k is then allocated to bookings by SMU weight.
 * PTP/DTP-only bookings are explicitly excluded.
 */
export function allocateFinanceIncomingHandling(bookings=[],smuMap=new Map()){
  const rows=[];
  for(const b of bookings||[]){
    const bookingId=clean(b?.bookingId,120);if(!bookingId||!isLastmileEligible(b))continue;
    const assigned=smuMap.get(bookingId)||null;
    const numbers=(Array.isArray(assigned?.smuNumbers)?assigned.smuNumbers:[assigned?.smuNumber]).map(x=>String(x||'').trim()).filter(Boolean);
    rows.push({
      bookingId,
      chargeableWeightKg:kg(b?.chargeableWeightKg||b?.weightKg),
      smuNumbers:numbers.length?numbers:[`BOOKING-${bookingId}`],
      isLastmileIncoming:true,
    });
  }
  if(!rows.length)return {total:0,smuCount:0,bookingMap:new Map(),allocations:[],ruleVersion:null};
  const allocated=allocateOperationalCosts(rows),bookingMap=new Map(),allocations=[];
  for(const row of allocated.bookings||[]){
    const components=handlingComponents(row),amount=components.reduce((s,c)=>s+money(c.amount),0);
    bookingMap.set(row.bookingId,amount);
    allocations.push({bookingId:row.bookingId,amount,components});
  }
  const total=allocations.reduce((s,x)=>s+x.amount,0);
  return {total,smuCount:allocated.smuCount,bookingMap,allocations,ruleVersion:allocated.ruleVersion};
}

export function handlingForBookings(bookingIds=[],allocation){
  const ids=new Set((bookingIds||[]).map(String));let total=0;for(const [id,amount] of allocation?.bookingMap||[])if(ids.has(String(id)))total+=money(amount);return total;
}
