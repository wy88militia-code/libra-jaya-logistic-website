import { cleanParty, findBookingByIdempotency, getBooking, newBookingId, reserveIdempotency, saveBooking, updateBooking, validateDestination } from './_booking-core.mjs';
import { createOperationalNotification } from './_notification-core.mjs';
import { finalizeQuote, getQuote, releaseQuote, reserveQuote } from './_quote-core.mjs';
import { getWallet, mutateWallet } from './_partner-core.mjs';
import { estimateVendorCostForBooking } from './_vendor-master-core.mjs';

function validateCore(partner,input,idempotencyKey){
  const quoteId=String(input?.quoteId||'').trim().slice(0,100);const idem=String(idempotencyKey||input?.idempotencyKey||'').trim().slice(0,120);
  if(!quoteId||idem.length<8){const e=new Error('Quote ID dan Idempotency-Key minimal 8 karakter wajib diisi.');e.code='INVALID_BOOKING_REQUEST';throw e;}
  return {quoteId,idem};
}
async function validatePartiesAndDestination(partner,input,quote){
  if(quote.partnerId!==partner.partnerId){const e=new Error('Quote bukan milik partner ini.');e.code='QUOTE_FORBIDDEN';throw e;}
  const destination=validateDestination(input?.destination||{},quote);const sender=cleanParty(input?.sender);const recipient=cleanParty(input?.recipient);
  if(!sender.name||!recipient.name||!recipient.phone||!recipient.address){const e=new Error('Nama pengirim, nama/HP/alamat penerima wajib diisi.');e.code='INVALID_PARTY';throw e;}
  return {destination,sender,recipient};
}
async function vendorCostSnapshotForBooking(booking){
  try{const expected=await estimateVendorCostForBooking(booking);if(!expected.snapshotVersion)return null;return {snapshotVersion:expected.snapshotVersion,total:Math.trunc(Number(expected.total)||0),components:expected.components||[],status:expected.status||'ESTIMATED',source:'BOOKING_CREATION',capturedAt:new Date().toISOString()};}catch{return null;}
}

export async function createUatBookingForPartner(partner,input={},idempotencyKey){
  const {quoteId,idem}=validateCore(partner,input,idempotencyKey);let existing=await findBookingByIdempotency(partner.partnerId,idem);
  if(existing){if(existing.source!=='API_UAT'){const e=new Error('Idempotency-Key sudah dipakai pada transaksi non-UAT.');e.code='IDEMPOTENCY_CONFLICT';throw e;}return {booking:existing,balance:(await getWallet(partner.partnerId)).balance,duplicate:true,uat:true};}
  const quote=await getQuote(quoteId);if(!quote){const e=new Error('Quote tidak ditemukan.');e.code='QUOTE_NOT_FOUND';throw e;}if(quote.status!=='APPROVED'){const e=new Error(`Quote UAT belum APPROVED. Status: ${quote.status}.`);e.code='QUOTE_NOT_APPROVED';throw e;}if(!Number.isFinite(Number(quote.amount))||Number(quote.amount)<=0){const e=new Error('Quote UAT tidak memiliki nominal sah.');e.code='QUOTE_INVALID';throw e;}
  const {destination,sender,recipient}=await validatePartiesAndDestination(partner,input,quote);const proposedId=newBookingId();const reservation=await reserveIdempotency(partner.partnerId,idem,proposedId);
  if(!reservation.created){existing=await getBooking(reservation.bookingId);if(existing?.source==='API_UAT')return {booking:existing,balance:(await getWallet(partner.partnerId)).balance,duplicate:true,uat:true};const e=new Error('Idempotency-Key sedang dipakai proses lain.');e.code='IDEMPOTENCY_CONFLICT';throw e;}
  const createdAt=new Date().toISOString();const booking={bookingId:proposedId,partnerId:partner.partnerId,quoteId,status:'UAT_VALIDATED',source:'API_UAT',idempotencyKey:idem,partnerReference:String(input?.partnerReference||'').trim().slice(0,120),sender,recipient,destination,weightKg:quote.weightKg,chargeableWeightKg:Number(quote.chargeableKg||quote.weightKg)||null,kodeRute:quote.kodeRute,service:quote.skemaLayanan||null,amount:Number(quote.amount),currency:'IDR',sla:quote.sla,masterVersion:quote.masterVersion,uat:true,walletDebited:false,createdAt,updatedAt:createdAt};
  const vendorCostSnapshot=await vendorCostSnapshotForBooking(booking);if(vendorCostSnapshot)booking.vendorCostSnapshot=vendorCostSnapshot;
  await saveBooking(booking,{onlyIfNew:true});return {booking,balance:(await getWallet(partner.partnerId)).balance,duplicate:false,uat:true};
}

export async function createBookingForPartner(partner,input={},idempotencyKey,source='PORTAL'){
  const {quoteId,idem}=validateCore(partner,input,idempotencyKey);
  let existing=await findBookingByIdempotency(partner.partnerId,idem);if(existing?.status==='BOOKED')return {booking:existing,balance:(await getWallet(partner.partnerId)).balance,duplicate:true};
  const quote=await getQuote(quoteId);if(!quote){const e=new Error('Quote tidak ditemukan.');e.code='QUOTE_NOT_FOUND';throw e;}const {destination,sender,recipient}=await validatePartiesAndDestination(partner,input,quote);
  let booking=existing;
  if(!booking){const proposedId=newBookingId();const reservation=await reserveIdempotency(partner.partnerId,idem,proposedId);if(!reservation.created){booking=await getBooking(reservation.bookingId);if(booking?.status==='BOOKED')return {booking,balance:(await getWallet(partner.partnerId)).balance,duplicate:true};}if(!booking){const createdAt=new Date().toISOString();booking={bookingId:proposedId,partnerId:partner.partnerId,quoteId,status:'PAYMENT_PENDING',source:String(source||'PORTAL').slice(0,20),idempotencyKey:idem,partnerReference:String(input?.partnerReference||'').trim().slice(0,120),sender,recipient,destination,weightKg:quote.weightKg,chargeableWeightKg:Number(quote.chargeableKg||quote.weightKg)||null,kodeRute:quote.kodeRute,service:quote.skemaLayanan||null,amount:Number(quote.amount)||null,currency:'IDR',sla:quote.sla,masterVersion:quote.masterVersion,createdAt,updatedAt:createdAt};const vendorCostSnapshot=await vendorCostSnapshotForBooking(booking);if(vendorCostSnapshot)booking.vendorCostSnapshot=vendorCostSnapshot;await saveBooking(booking,{onlyIfNew:true});}}
  let quoteReservation;
  try{quoteReservation=await reserveQuote(partner.partnerId,quoteId,booking.bookingId);const amount=Math.trunc(Number(quoteReservation.quote.amount));const wallet=await mutateWallet(partner.partnerId,-amount,`BOOKING:${booking.bookingId}`,{source:'BOOKING',description:`Booking ${booking.bookingId}`,metadata:{quoteId,kodeRute:quote.kodeRute,partnerReference:booking.partnerReference,source}});booking=await updateBooking(booking.bookingId,{status:'BOOKED',amount,transactionId:wallet.transactionId,bookedAt:new Date().toISOString(),paymentError:null});await finalizeQuote(quoteId,booking.bookingId,wallet.transactionId);try{await createOperationalNotification({partnerId:partner.partnerId,type:'BOOKING_CREATED',severity:'SUCCESS',title:'Booking berhasil dibuat',message:`Booking ${booking.bookingId} berhasil dibuat untuk ${booking.destination?.kelurahan||quote.kelurahan||'tujuan'} senilai Rp${amount.toLocaleString('id-ID')}.`,reference:booking.bookingId,partnerLink:'/partner/history.html',adminLink:'/admin-bookings',dedupeKey:`booking-created:${booking.bookingId}`,metadata:{bookingId:booking.bookingId,source:booking.source,amount,partnerReference:booking.partnerReference||null}});}catch{}try{const module=await import('./_sla-monitor-core.mjs');await module.evaluateBookingSla(booking,{emitAlerts:false});}catch{}return {booking,balance:wallet.balance,duplicate:wallet.duplicate};}
  catch(error){if(quoteReservation&&!quoteReservation.idempotent)await releaseQuote(quoteId,error?.code||error?.message||'BOOKING_FAILED');try{booking=await updateBooking(booking.bookingId,{status:error?.code==='INSUFFICIENT_BALANCE'?'WAITING_TOPUP':'PAYMENT_FAILED',paymentError:String(error?.message||'Booking gagal').slice(0,300)});}catch{}error.bookingId=booking?.bookingId;throw error;}
}
