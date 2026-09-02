import { cleanParty, findBookingByIdempotency, getBooking, newBookingId, reserveIdempotency, saveBooking, updateBooking, validateDestination } from './_booking-core.mjs';
import { finalizeQuote, getQuote, releaseQuote, reserveQuote } from './_quote-core.mjs';
import { getWallet, mutateWallet, requirePartnerSession } from './_partner-core.mjs';

export default async request=>{
  const partner=await requirePartnerSession(request);if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
  if(request.method!=='POST')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
  let body;try{body=await request.json();}catch{return Response.json({message:'Permintaan tidak valid.'},{status:400});}
  const quoteId=String(body?.quoteId||'').trim().slice(0,100);const idem=String(request.headers.get('idempotency-key')||body?.idempotencyKey||'').trim().slice(0,120);
  if(!quoteId||idem.length<8)return Response.json({message:'Quote ID dan Idempotency-Key minimal 8 karakter wajib diisi.'},{status:400});

  let existing=await findBookingByIdempotency(partner.partnerId,idem);
  if(existing?.status==='BOOKED')return Response.json({ok:true,duplicate:true,booking:existing,balance:(await getWallet(partner.partnerId)).balance});
  const quote=await getQuote(quoteId);if(!quote)return Response.json({message:'Quote tidak ditemukan.'},{status:404});
  if(quote.partnerId!==partner.partnerId)return Response.json({message:'Quote bukan milik partner ini.'},{status:403});

  let destination;try{destination=validateDestination(body?.destination||{},quote);}catch(error){return Response.json({message:error.message},{status:422});}
  const sender=cleanParty(body?.sender);const recipient=cleanParty(body?.recipient);
  if(!sender.name||!recipient.name||!recipient.phone||!recipient.address)return Response.json({message:'Nama pengirim, nama/HP/alamat penerima wajib diisi.'},{status:422});

  let booking=existing;
  if(!booking){
    const proposedId=newBookingId();const reservation=await reserveIdempotency(partner.partnerId,idem,proposedId);
    if(!reservation.created){booking=await getBooking(reservation.bookingId);if(booking?.status==='BOOKED')return Response.json({ok:true,duplicate:true,booking,balance:(await getWallet(partner.partnerId)).balance});}
    if(!booking){
      const createdAt=new Date().toISOString();booking={bookingId:proposedId,partnerId:partner.partnerId,quoteId,status:'PAYMENT_PENDING',source:'PORTAL',partnerReference:String(body?.partnerReference||'').trim().slice(0,120),sender,recipient,destination,weightKg:quote.weightKg,kodeRute:quote.kodeRute,amount:Number(quote.amount)||null,currency:'IDR',sla:quote.sla,masterVersion:quote.masterVersion,createdAt,updatedAt:createdAt};
      await saveBooking(booking,{onlyIfNew:true});
    }
  }

  let quoteReservation;
  try{
    quoteReservation=await reserveQuote(partner.partnerId,quoteId,booking.bookingId);
    const amount=Math.trunc(Number(quoteReservation.quote.amount));
    const wallet=await mutateWallet(partner.partnerId,-amount,`BOOKING:${booking.bookingId}`,{source:'BOOKING',description:`Booking ${booking.bookingId}`,metadata:{quoteId,kodeRute:quote.kodeRute,partnerReference:booking.partnerReference}});
    booking=await updateBooking(booking.bookingId,{status:'BOOKED',amount,transactionId:wallet.transactionId,bookedAt:new Date().toISOString(),paymentError:null});
    await finalizeQuote(quoteId,booking.bookingId,wallet.transactionId);
    return Response.json({ok:true,duplicate:wallet.duplicate,booking,balance:wallet.balance},{status:201});
  }catch(error){
    if(quoteReservation&&!quoteReservation.idempotent)await releaseQuote(quoteId,error?.code||error?.message||'BOOKING_FAILED');
    try{booking=await updateBooking(booking.bookingId,{status:error?.code==='INSUFFICIENT_BALANCE'?'WAITING_TOPUP':'PAYMENT_FAILED',paymentError:String(error?.message||'Booking gagal').slice(0,300)});}catch{}
    if(error?.code==='INSUFFICIENT_BALANCE')return Response.json({ok:false,code:'INSUFFICIENT_BALANCE',message:'Saldo deposit tidak cukup. Booking tersimpan menunggu top-up.',bookingId:booking.bookingId,balance:error.balance},{status:402});
    return Response.json({ok:false,code:error?.code||'BOOKING_ERROR',message:error?.message||'Booking tidak dapat diproses.',bookingId:booking.bookingId},{status:409});
  }
};

export const config={path:'/.netlify/functions/partner-booking-create',method:'POST',rateLimit:{windowSize:60,windowLimit:30,aggregateBy:'ip',action:'rate_limit'}};
