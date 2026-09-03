import { getStore } from '@netlify/blobs';
import { listBookings } from './_booking-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { getQuote } from './_quote-core.mjs';

const STORE='libra-sla-monitor';
const TRACKING_STORE='libra-tracking';
const store=()=>getStore(STORE);
const trackingStore=()=>getStore(TRACKING_STORE);
const now=()=>new Date().toISOString();
const terminal=new Set(['PAYMENT_FAILED','WAITING_TOPUP','PAYMENT_PENDING','UAT_VALIDATED']);
const incidentStatuses=new Set(['HELD','DAMAGED','CLAIM_PROCESS']);
const rank={BOOKED:0,PICKUP_ASSIGNED:1,PICKED_UP:2,AT_ORIGIN_HUB:3,IN_TRANSIT:4,CONNECTING_FLIGHT:5,ARRIVED_DESTINATION:6,OUT_FOR_DELIVERY:7,DELIVERED:8};

function parseSlaHours(value){
  const text=String(value||'').toLowerCase().replace(/,/g,'.');if(!text)return null;let max=null;
  for(const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:-|–|s\/?d|to)?\s*(\d+(?:\.\d+)?)?\s*(jam|hour|hours|hr|hrs|hari|day|days)/g)){const a=Number(m[1]),b=m[2]?Number(m[2]):a,unit=m[3];const n=Math.max(a,b)*(unit.startsWith('hari')||unit.startsWith('day')?24:1);if(Number.isFinite(n)&&n>0)max=Math.max(max||0,n);}
  if(max)return max;const hp=text.match(/h\s*\+\s*(\d+(?:\.\d+)?)/);if(hp)return Number(hp[1])*24;return null;
}
function cutoffParts(value){const m=String(value||'').match(/^(\d{1,2}):(\d{2})/);if(!m)return null;const h=Number(m[1]),min=Number(m[2]);return h>=0&&h<24&&min>=0&&min<60?{h,min}:null;}
function witClock(date){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jayapura',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);return {h:Number(parts.find(p=>p.type==='hour')?.value||0),min:Number(parts.find(p=>p.type==='minute')?.value||0)};}
function afterCutoff(date,cutoff){const cp=cutoffParts(cutoff);if(!cp)return false;const wc=witClock(date);return wc.h>cp.h||(wc.h===cp.h&&wc.min>cp.min);}
function hours(ms){return ms/3600000;}
function isConnecting(booking,quote){return /connect|flight|udara|wmx|wamena|djj\s*[-→>]\s*wmx/i.test(`${quote?.skemaLayanan||''} ${booking?.kodeRute||''} ${booking?.destination?.kabupatenKota||''}`);}
async function latestTracking(bookingId){return trackingStore().get(`latest/${bookingId}`,{type:'json',consistency:'strong'});}
function activeBooking(booking){return booking&&booking.source!=='API_UAT'&&!terminal.has(String(booking.status||'').toUpperCase());}
function dedupe(level,bookingId,dueAt){return `sla:${level}:${bookingId}:${dueAt||'unknown'}`;}

export async function getSlaStatus(bookingId){return store().get(`status/${String(bookingId||'').trim()}`,{type:'json',consistency:'strong'});}
export async function evaluateBookingSla(booking,{emitAlerts=true}={}){
  if(!activeBooking(booking))return null;
  const quote=booking.quoteId?await getQuote(booking.quoteId):null;const slaText=booking.sla||quote?.sla||null;const slaHours=parseSlaHours(slaText);const previous=await getSlaStatus(booking.bookingId);const latest=await latestTracking(booking.bookingId);const currentStatus=String(latest?.status||booking.currentTrackingStatus||booking.status||'BOOKED').toUpperCase();
  const bookedAt=new Date(booking.bookedAt||booking.createdAt||Date.now());const cutoffWit=quote?.cutoffWit||null;const cutoffRolled=afterCutoff(bookedAt,cutoffWit);const startAtMs=bookedAt.getTime()+(cutoffRolled?24*3600000:0);const startAt=new Date(startAtMs).toISOString();const referenceTime=new Date(booking.deliveredAt||Date.now()).getTime();
  let dueAt=null,remainingHours=null,elapsedRatio=null,breached=false,riskLevel='GREEN',slaState='ON_TRACK';const reasons=[];const connecting=isConnecting(booking,quote);const lastUpdateAt=latest?.createdAt||booking.lastTrackingAt||booking.bookedAt||booking.createdAt;const staleHours=Math.max(0,hours(Date.now()-new Date(lastUpdateAt).getTime()));
  if(!slaHours){riskLevel='YELLOW';slaState='UNMONITORED';reasons.push('SLA rute belum dapat dibaca dari Master/Quote.');}
  else{
    const dueMs=startAtMs+slaHours*3600000;dueAt=new Date(dueMs).toISOString();remainingHours=hours(dueMs-referenceTime);elapsedRatio=Math.max(0,Math.min(2,hours(referenceTime-startAtMs)/slaHours));breached=referenceTime>dueMs;
    if(incidentStatuses.has(currentStatus)){riskLevel='RED';slaState='AT_RISK';reasons.push(`Status operasional ${currentStatus}.`);}
    if(breached&&currentStatus!=='DELIVERED'){riskLevel='RED';slaState='BREACHED';reasons.push(`Lewat estimasi SLA ${Math.abs(remainingHours).toFixed(1)} jam.`);}
    if(currentStatus==='DELIVERED'){riskLevel=breached?'RED':'GREEN';slaState=breached?'DELIVERED_LATE':'DELIVERED_ON_TIME';reasons.push(breached?'Delivered melewati SLA.':'Delivered dalam SLA.');}
    if(currentStatus!=='DELIVERED'&&!breached){const warningWindow=Math.min(8,Math.max(3,slaHours*0.2));if(elapsedRatio>=0.8||remainingHours<=warningWindow){riskLevel=riskLevel==='RED'?'RED':'YELLOW';slaState=riskLevel==='RED'?'AT_RISK':'AT_RISK';reasons.push(`Sisa SLA ${Math.max(0,remainingHours).toFixed(1)} jam.`);}}
    if(currentStatus!=='DELIVERED'&&!incidentStatuses.has(currentStatus)){const staleWarn=Math.min(12,Math.max(4,slaHours*0.25)),staleCritical=Math.min(24,Math.max(8,slaHours*0.5));if(staleHours>=staleCritical){riskLevel='RED';slaState='AT_RISK';reasons.push(`Tidak ada update tracking ${staleHours.toFixed(1)} jam.`);}else if(staleHours>=staleWarn&&riskLevel==='GREEN'){riskLevel='YELLOW';slaState='AT_RISK';reasons.push(`Tracking belum diperbarui ${staleHours.toFixed(1)} jam.`);}}
    if(connecting&&currentStatus!=='DELIVERED'){const r=rank[currentStatus]??0;if(elapsedRatio>=0.8&&r<(rank.ARRIVED_DESTINATION)){riskLevel='RED';slaState='AT_RISK';reasons.push('Connecting flight belum mencapai hub tujuan saat >80% SLA terpakai.');}else if(elapsedRatio>=0.6&&r<rank.CONNECTING_FLIGHT&&riskLevel==='GREEN'){riskLevel='YELLOW';slaState='AT_RISK';reasons.push('Connecting flight belum tercatat saat >60% SLA terpakai.');}}
  }
  const record={bookingId:booking.bookingId,partnerId:booking.partnerId,partnerReference:booking.partnerReference||null,kodeRute:booking.kodeRute||quote?.kodeRute||null,destination:booking.destination||null,currentStatus,slaText,slaHours,cutoffWit,cutoffRolled,estimatedStartAt:startAt,dueAt,remainingHours,elapsedRatio,breached,connectingFlight:connecting,lastTrackingAt:lastUpdateAt,staleHours,riskLevel,slaState,reasons,bookingCreatedAt:booking.createdAt,bookedAt:booking.bookedAt||null,deliveredAt:booking.deliveredAt||null,evaluatedAt:now()};
  await store().setJSON(`status/${booking.bookingId}`,record);if(!previous||previous.riskLevel!==riskLevel||previous.slaState!==slaState)await store().setJSON(`history/${booking.bookingId}/${record.evaluatedAt}`,{from:previous?{riskLevel:previous.riskLevel,slaState:previous.slaState}:null,to:{riskLevel,slaState},reasons,at:record.evaluatedAt},{onlyIfNew:true});
  if(emitAlerts&&currentStatus!=='DELIVERED'){
    try{if(riskLevel==='RED'&&(previous?.riskLevel!=='RED'||previous?.slaState!==slaState))await createOperationalNotification({partnerId:booking.partnerId,type:breached?'SLA_BREACH':'SLA_RISK',severity:'CRITICAL',title:breached?'SLA kiriman terlewati':'Kiriman berisiko tinggi terlambat',message:`${booking.bookingId}${booking.partnerReference?` / ${booking.partnerReference}`:''}: ${reasons.join(' ')||'Perlu pengecekan operasional.'}`,reference:booking.bookingId,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-sla-control',dedupeKey:dedupe(breached?'BREACH':'RED',booking.bookingId,dueAt),metadata:{bookingId:booking.bookingId,partnerId:booking.partnerId,riskLevel,slaState,dueAt,currentStatus,kodeRute:booking.kodeRute||null}});else if(riskLevel==='YELLOW'&&previous?.riskLevel!=='YELLOW')await createOperationalNotification({partnerId:booking.partnerId,type:'SLA_RISK',severity:'WARNING',title:'Kiriman mendekati risiko SLA',message:`${booking.bookingId}: ${reasons.join(' ')||'SLA perlu dipantau.'}`,reference:booking.bookingId,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-sla-control',dedupeKey:dedupe('YELLOW',booking.bookingId,dueAt),metadata:{bookingId:booking.bookingId,partnerId:booking.partnerId,riskLevel,slaState,dueAt,currentStatus,kodeRute:booking.kodeRute||null}});else if(riskLevel==='GREEN'&&['YELLOW','RED'].includes(previous?.riskLevel))await createOperationalNotification({partnerId:booking.partnerId,type:'SLA_RECOVERED',severity:'SUCCESS',title:'Risiko SLA kembali normal',message:`${booking.bookingId} kembali dalam kondisi hijau setelah update operasional.`,reference:booking.bookingId,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-sla-control',dedupeKey:`sla:recovered:${booking.bookingId}:${record.evaluatedAt.slice(0,13)}`});}catch{}
  }
  return record;
}
export async function scanSlaBookings(limit=1500){const bookings=await listBookings(Math.max(1,Math.min(Number(limit)||1500,2000)));const results=[];for(const booking of bookings){if(!activeBooking(booking))continue;try{const row=await evaluateBookingSla(booking,{emitAlerts:true});if(row)results.push(row);}catch(error){results.push({bookingId:booking.bookingId,partnerId:booking.partnerId,riskLevel:'ERROR',slaState:'ERROR',reasons:[String(error?.message||error).slice(0,300)],evaluatedAt:now()});}}return results;}
export async function listSlaStatuses(limit=500){const {blobs}=await store().list({prefix:'status/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(Number(limit)||500,2000)));const rows=[];for(const blob of selected){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}const severity={RED:0,YELLOW:1,ERROR:2,GREEN:3};return rows.sort((a,b)=>(severity[a.riskLevel]??9)-(severity[b.riskLevel]??9)||String(a.dueAt||'9999').localeCompare(String(b.dueAt||'9999')));}
export async function getSlaSummary(){const rows=await listSlaStatuses(2000);const active=rows.filter(r=>!String(r.slaState||'').startsWith('DELIVERED_'));const delivered=rows.filter(r=>String(r.slaState||'').startsWith('DELIVERED_'));const onTime=delivered.filter(r=>r.slaState==='DELIVERED_ON_TIME').length;return {total:rows.length,active:active.length,green:active.filter(r=>r.riskLevel==='GREEN').length,yellow:active.filter(r=>r.riskLevel==='YELLOW').length,red:active.filter(r=>r.riskLevel==='RED').length,error:active.filter(r=>r.riskLevel==='ERROR').length,breached:active.filter(r=>r.slaState==='BREACHED').length,delivered:delivered.length,deliveredLate:delivered.filter(r=>r.slaState==='DELIVERED_LATE').length,onTimePct:delivered.length?Math.round(onTime/delivered.length*1000)/10:null};}
