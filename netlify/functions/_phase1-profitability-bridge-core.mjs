import { listPhase1MarketplaceBatches } from './_phase1-marketplace-core.mjs';

const ACTIVE_COST_STATUSES=new Set(['MANIFEST_OPEN','READY_TO_DEPART','DEPARTED_CGK','LASTMILE_READY_DJJ','COMPLETED']);
const money=v=>Math.max(0,Math.round(Number(v)||0));
const clean=(v,n=140)=>String(v??'').trim().slice(0,n);

function row(map,bookingId){
  const id=clean(bookingId,120);if(!id)return null;
  if(!map.has(id))map.set(id,{bookingId:id,phase1AirlineCost:0,phase1IncomingHandlingCost:0,phase1OperationalCost:0,batchIds:[],smuNumbers:[],sources:[]});
  return map.get(id);
}
function addUnique(array,value){const v=clean(value);if(v&&!array.includes(v))array.push(v);}

/**
 * Read-only bridge from authoritative Phase 1 batch snapshots to booking-level
 * profitability. Cancelled/failed/partial setup batches are excluded.
 * Customer pricing is never changed by this bridge.
 */
export async function getPhase1ProfitabilityAllocationMap(limit=1000){
  const batches=await listPhase1MarketplaceBatches(Math.max(1,Math.min(Number(limit)||1000,1000))),map=new Map();
  for(const batch of batches||[]){
    if(!ACTIVE_COST_STATUSES.has(String(batch?.status||'').toUpperCase()))continue;
    const batchId=clean(batch.batchId,140),smuNumber=clean(batch.smuNumber,80);
    for(const a of batch.vendorCostSnapshot?.allocations||[]){
      const x=row(map,a.bookingId);if(!x)continue;const amount=money(a.amount);x.phase1AirlineCost+=amount;addUnique(x.batchIds,batchId);addUnique(x.smuNumbers,smuNumber);x.sources.push({type:'PHASE1_AIRLINE_BATCH',batchId,smuNumber,amount});
    }
    for(const a of batch.lastmileHandlingSnapshot?.allocations||[]){
      const x=row(map,a.bookingId);if(!x)continue;const amount=money(a.amount);x.phase1IncomingHandlingCost+=amount;addUnique(x.batchIds,batchId);addUnique(x.smuNumbers,a.smuNumber||smuNumber);x.sources.push({type:'PHASE1_UNIQUE_SMU_HANDLING',batchId,smuNumber:clean(a.smuNumber||smuNumber,80),amount});
    }
  }
  for(const x of map.values())x.phase1OperationalCost=money(x.phase1AirlineCost+x.phase1IncomingHandlingCost);
  return map;
}

export function phase1CostForBooking(map,bookingId){return map?.get(String(bookingId))||{bookingId:String(bookingId||''),phase1AirlineCost:0,phase1IncomingHandlingCost:0,phase1OperationalCost:0,batchIds:[],smuNumbers:[],sources:[]};}
