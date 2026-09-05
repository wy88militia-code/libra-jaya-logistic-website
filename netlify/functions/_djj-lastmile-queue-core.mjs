import { listBookings } from './_booking-core.mjs';
import { listAssignments } from './_courier-custody-core.mjs';
import { listWarehouseShipments } from './_warehouse-core.mjs';
import { getMasterSnapshot } from './_master-sheet-core.mjs';
import { getBookingSmuManifest, getBookingSmuReconciliation } from './_smu-core.mjs';
import { DJJ_LASTMILE_ENGINE, isDjjLastmileRoute, djjLastmileMetadata } from './_djj-lastmile-engine.mjs';

const INCIDENTS=new Set(['HELD','DAMAGED','LOST','MIXED_UP','CLAIM_PROCESS']);
const DELIVERY_PROGRESS=new Set(['ARRIVED_DESTINATION','OUT_FOR_DELIVERY','DELIVERED']);
const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;

function mapBy(rows,key){return new Map((rows||[]).filter(Boolean).map(r=>[String(r?.[key]||''),r]));}
function trackingStatus(booking){return upper(booking?.currentTrackingStatus||booking?.status||'BOOKED');}
function sourceChannel(booking={}){
  const explicit=upper(booking?.lastmileEngine?.channel);
  if(booking?.lastmileEngine?.id===DJJ_LASTMILE_ENGINE.id&&DJJ_LASTMILE_ENGINE.channels.includes(explicit))return explicit;
  const source=upper(booking.source);
  if(source==='API')return 'PARTNER_API';
  if(source==='JLX_SOETTA_ADMIN'&&upper(booking.serviceType)==='PTD'&&booking.requiresLastmile!==false)return 'JLX_INTERNAL';
  return null;
}
function routeMap(snapshot){return new Map((snapshot?.routes||[]).map(r=>[String(r.kodeRute||''),r]));}
function warehouseAtDjj(row){const hub=upper(row?.hub);return Boolean(row&&['INBOUND','STORED','HOLD','DAMAGED'].includes(upper(row.status))&&(hub==='DJJ'||hub.includes('SENTANI')||hub.includes('JAYAPURA')));}
function stageFor({booking,channel,assignment,warehouse,reconciliation}){
  const tracking=trackingStatus(booking),reconStatus=upper(reconciliation?.status),issueCount=num(reconciliation?.summary?.issueCount);
  if(tracking==='DELIVERED')return {code:'DELIVERED',label:'Delivered',tone:'good',ready:false};
  if(INCIDENTS.has(tracking)||issueCount>0||reconStatus==='COMPLETE_WITH_ISSUE')return {code:'HOLD',label:'Hold / Issue',tone:'bad',ready:false};
  if(tracking==='OUT_FOR_DELIVERY')return {code:'OUT_FOR_DELIVERY',label:'Out for Delivery',tone:'blue',ready:false};
  if(channel==='JLX_INTERNAL'){
    if(!DELIVERY_PROGRESS.has(tracking))return {code:'WAITING_FLIGHT',label:'Menunggu Arrival DJJ',tone:'neutral',ready:false};
    if(assignment&&upper(assignment.status)!=='COMPLETED')return {code:'ASSIGNED',label:'Kurir Ter-assign',tone:'blue',ready:false};
    return {code:'READY_ASSIGNMENT',label:'Siap Assign Kurir',tone:'good',ready:true};
  }
  if(!warehouseAtDjj(warehouse))return {code:'WAITING_HUB_RECEIPT',label:'Menunggu Inbound DJJ',tone:'neutral',ready:false};
  if(!['AT_ORIGIN_HUB','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED'].includes(tracking))return {code:'WAITING_HUB_SCAN',label:'Inbound Belum Diakui',tone:'warn',ready:false};
  if(!reconciliation)return {code:'WAITING_PTI',label:'Menunggu Rekap PTI/SMU',tone:'warn',ready:false};
  if(!reconStatus.startsWith('COMPLETE'))return {code:'WAITING_PTI',label:'Menunggu Rekap PTI/SMU',tone:'warn',ready:false};
  if(assignment&&upper(assignment.status)!=='COMPLETED')return {code:'ASSIGNED',label:'Kurir Ter-assign',tone:'blue',ready:false};
  return {code:'READY_ASSIGNMENT',label:'Siap Assign Kurir',tone:'good',ready:true};
}

export async function buildDjjLastmileQueue(limit=500){
  const safe=Math.max(1,Math.min(Number(limit)||500,1200));
  const [bookings,assignments,warehouseRows,snapshot]=await Promise.all([listBookings(safe),listAssignments(safe),listWarehouseShipments(safe),getMasterSnapshot()]);
  const assignmentsByBooking=mapBy(assignments,'bookingId'),warehouseByBooking=mapBy(warehouseRows,'bookingId'),routes=routeMap(snapshot),rows=[];
  for(const booking of bookings){
    const channel=sourceChannel(booking);if(!channel||booking.uat)continue;
    const route=routes.get(String(booking.kodeRute||''))||null;if(!route||!isDjjLastmileRoute(route))continue;
    const [manifest,reconciliation]=channel==='PARTNER_API'?await Promise.all([getBookingSmuManifest(booking.bookingId),getBookingSmuReconciliation(booking.bookingId)]):[null,null];
    const assignment=assignmentsByBooking.get(String(booking.bookingId))||null,warehouse=warehouseByBooking.get(String(booking.bookingId))||null,stage=stageFor({booking,channel,assignment,warehouse,reconciliation});
    const basisWeightKg=channel==='PARTNER_API'?num(booking.smuTotalWeightKg||booking.weightKg):num(booking.chargeableWeightKg||booking.weightKg);
    rows.push({booking,channel,engine:djjLastmileMetadata(channel),route,assignment,warehouse,smuManifest:manifest,reconciliation,stage,basisWeightKg,weightBasis:channel==='PARTNER_API'?'PARTNER_PTI':'JLX_FINAL_CHARGEABLE',routeRateReferencePerKg:num(route.tarifRekomKg),routeFloorPerKg:num(route.tarifFloorKg),routeFullCostTrip:num(route.fullCostTrip),sla:route.slaTotalHub||route.slaLastmile||route.slaMaster||null});
  }
  rows.sort((a,b)=>String(b.booking.updatedAt||b.booking.createdAt||'').localeCompare(String(a.booking.updatedAt||a.booking.createdAt||'')));
  const count=code=>rows.filter(r=>r.stage.code===code).length;
  return {engine:DJJ_LASTMILE_ENGINE,masterVersion:snapshot?.version||null,syncedAt:snapshot?.syncedAt||null,summary:{total:rows.length,partnerApi:rows.filter(r=>r.channel==='PARTNER_API').length,jlxInternal:rows.filter(r=>r.channel==='JLX_INTERNAL').length,waitingHub:count('WAITING_HUB_RECEIPT')+count('WAITING_HUB_SCAN'),waitingPti:count('WAITING_PTI'),ready:count('READY_ASSIGNMENT'),assigned:count('ASSIGNED'),outForDelivery:count('OUT_FOR_DELIVERY'),delivered:count('DELIVERED'),hold:count('HOLD')},rows};
}

export async function getDjjLastmileRow(bookingId){const queue=await buildDjjLastmileQueue(1200);return queue.rows.find(r=>String(r.booking.bookingId)===String(bookingId))||null;}
