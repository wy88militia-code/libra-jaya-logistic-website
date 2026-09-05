import { listBookings } from './_booking-core.mjs';
import { listAssignments } from './_courier-custody-core.mjs';
import { listWarehouseShipments } from './_warehouse-core.mjs';
import { listWeightRecords } from './_weight-core.mjs';
import { listManifests } from './_manifest-core.mjs';

const ACTIVE_EXCLUDED=new Set(['DELIVERED','PAYMENT_FAILED']);
const PAYMENT_BLOCKED=new Set(['PAYMENT_PENDING','WAITING_TOPUP','PAYMENT_FAILED']);

function mapBy(rows,key){return new Map((rows||[]).filter(Boolean).map(r=>[String(r?.[key]||''),r]));}
function manifestBookingMap(manifests=[]){
  const out=new Map();
  for(const manifest of manifests){
    if(['CANCELLED','COMPLETED'].includes(String(manifest?.status||'').toUpperCase()))continue;
    for(const item of Object.values(manifest?.items||{}))if(item?.bookingId)out.set(String(item.bookingId),manifest);
  }
  return out;
}
function currentTracking(booking){return String(booking?.currentTrackingStatus||booking?.status||'').toUpperCase();}
function hasFinalPrice(booking){const amount=Number(booking?.amount);return Number.isFinite(amount)&&amount>0&&!['PENDING_FINAL_WEIGHT','PENDING_PRICING','RATE_REVIEW_REQUIRED'].includes(String(booking?.pricingStatus||'').toUpperCase());}

export function deriveSoettaStage({booking,assignment,warehouse,weight,manifest}={}){
  const bookingStatus=String(booking?.status||'').toUpperCase();
  const tracking=currentTracking(booking);
  const manifestStatus=String(manifest?.status||'').toUpperCase();
  const warehouseStatus=String(warehouse?.status||'').toUpperCase();
  const assignmentStatus=String(assignment?.status||'').toUpperCase();
  const weightStatus=String(weight?.weightStatus||'').toUpperCase();

  if(PAYMENT_BLOCKED.has(bookingStatus))return {code:'BLOCKED',label:'Tertahan Pembayaran',rank:0,tone:'bad',nextLabel:'Cek pembayaran',nextHref:'/admin-finance-billing'};
  if(['DEPARTED','ARRIVED','COMPLETED'].includes(manifestStatus)||['IN_TRANSIT','CONNECTING_FLIGHT','ARRIVED_DESTINATION','OUT_FOR_DELIVERY','DELIVERED'].includes(tracking))return {code:'BERANGKAT',label:'Berangkat / In Transit',rank:6,tone:'good',nextLabel:'Lihat Manifest',nextHref:'/admin-manifests'};
  if(manifest&&['OPEN','CLOSED'].includes(manifestStatus))return {code:'SMU',label:'SMU / Manifest',rank:5,tone:'blue',nextLabel:'Kelola SMU',nextHref:'/admin-manifests'};
  if(weight?.status==='VERIFIED'){
    if(weightStatus==='WEIGHT_ADJUSTMENT'||weight?.billingReviewRequired)return {code:'WEIGHT_ADJUSTMENT',label:'Perlu Approval Berat',rank:3,tone:'warn',nextLabel:'Review Timbang',nextHref:`/admin-weights?booking=${encodeURIComponent(booking.bookingId)}`};
    if(!hasFinalPrice(booking))return {code:'FINAL_PRICING',label:'Menunggu Harga Final',rank:4,tone:'warn',nextLabel:'Cek Berat Final',nextHref:`/admin-weights?booking=${encodeURIComponent(booking.bookingId)}`};
    return {code:'SIAP_FAKTUR',label:'Siap Faktur',rank:4,tone:'good',nextLabel:'Data Faktur Siap',nextHref:`/admin-weights?booking=${encodeURIComponent(booking.bookingId)}`};
  }
  if(warehouse&&['INBOUND','STORED','HOLD','DAMAGED'].includes(warehouseStatus))return {code:'GUDANG',label:warehouseStatus==='INBOUND'?'Terima Gudang':'Gudang Transit',rank:2,tone:warehouseStatus==='HOLD'||warehouseStatus==='DAMAGED'?'bad':'blue',nextLabel:'Timbang Barang',nextHref:`/admin-weights?booking=${encodeURIComponent(booking.bookingId)}`};
  if(['PICKED_UP','AT_ORIGIN_HUB'].includes(tracking)||['IN_CUSTODY','AT_HUB','HANDOVER_PENDING'].includes(assignmentStatus))return {code:'MENUJU_GUDANG',label:'Menuju Gudang',rank:2,tone:'blue',nextLabel:'Terima Gudang',nextHref:`/admin-warehouse?booking=${encodeURIComponent(booking.bookingId)}`};
  if(assignment||tracking==='PICKUP_ASSIGNED')return {code:'PICKUP',label:'Pickup / Jemput',rank:1,tone:'warn',nextLabel:'Kelola Pickup',nextHref:`/admin-courier-assignment?booking=${encodeURIComponent(booking.bookingId)}`};
  return {code:'PESANAN',label:'Pesanan Masuk',rank:0,tone:'neutral',nextLabel:'Terima & Assign Pickup',nextHref:`/admin-courier-assignment?booking=${encodeURIComponent(booking.bookingId)}`};
}

export async function buildJlxSoettaQueue(limit=400){
  const safeLimit=Math.max(1,Math.min(Number(limit)||400,800));
  const [bookings,assignments,warehouseRows,weightRows,manifests]=await Promise.all([
    listBookings(safeLimit),listAssignments(safeLimit),listWarehouseShipments(safeLimit),listWeightRecords(safeLimit),listManifests(300)
  ]);
  const assignmentMap=mapBy(assignments,'bookingId'),warehouseMap=mapBy(warehouseRows,'bookingId'),weightMap=mapBy(weightRows,'bookingId'),manifestMap=manifestBookingMap(manifests);
  const rows=bookings.filter(b=>!ACTIVE_EXCLUDED.has(String(b.status||'').toUpperCase())).map(booking=>{
    const assignment=assignmentMap.get(String(booking.bookingId))||null;
    const warehouse=warehouseMap.get(String(booking.bookingId))||null;
    const weight=weightMap.get(String(booking.bookingId))||null;
    const manifest=manifestMap.get(String(booking.bookingId))||null;
    const stage=deriveSoettaStage({booking,assignment,warehouse,weight,manifest});
    return {booking,assignment,warehouse,weight,manifest,stage};
  }).sort((a,b)=>String(b.booking.createdAt||'').localeCompare(String(a.booking.createdAt||'')));

  const count=code=>rows.filter(r=>r.stage.code===code).length;
  const summary={
    active:rows.length,
    pesanan:count('PESANAN'),
    pickup:count('PICKUP'),
    menujuGudang:count('MENUJU_GUDANG'),
    gudang:count('GUDANG'),
    weightAdjustment:count('WEIGHT_ADJUSTMENT'),
    finalPricing:count('FINAL_PRICING'),
    siapFaktur:count('SIAP_FAKTUR'),
    smu:count('SMU'),
    berangkat:count('BERANGKAT'),
    blocked:count('BLOCKED')
  };
  return {summary,rows};
}
