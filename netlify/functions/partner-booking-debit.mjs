import { finalizeQuote, releaseQuote, reserveQuote } from './_quote-core.mjs';
import { mutateWallet, requirePartnerSession } from './_partner-core.mjs';

export default async request=>{
  const partner=await requirePartnerSession(request);
  if(!partner)return Response.json({message:'Sesi partner tidak valid.'},{status:401});
  if(request.method!=='POST')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
  let body;try{body=await request.json();}catch{return Response.json({message:'Permintaan tidak valid.'},{status:400});}
  const bookingId=String(body?.bookingId||'').trim().slice(0,80);
  const quoteId=String(body?.quoteId||'').trim().slice(0,100);
  if(!bookingId||!quoteId)return Response.json({message:'Booking ID dan Quote ID wajib diisi.'},{status:400});

  let reservation;
  try{
    reservation=await reserveQuote(partner.partnerId,quoteId,bookingId);
    if(reservation.idempotent){
      return Response.json({ok:true,bookingId,quoteId,amount:reservation.quote.amount,transactionId:reservation.quote.transactionId,balance:null,duplicate:true});
    }
    const amount=Math.trunc(Number(reservation.quote.amount));
    const result=await mutateWallet(partner.partnerId,-amount,`BOOKING:${bookingId}`,{
      source:'BOOKING',description:`Pemotongan saldo booking ${bookingId}`,
      metadata:{quoteId,kodeRute:reservation.quote.kodeRute,weightKg:reservation.quote.weightKg,masterVersion:reservation.quote.masterVersion},
    });
    await finalizeQuote(quoteId,bookingId,result.transactionId);
    return Response.json({ok:true,bookingId,quoteId,amount,balance:result.balance,duplicate:result.duplicate,transactionId:result.transactionId});
  }catch(error){
    if(reservation&&!reservation.idempotent)await releaseQuote(quoteId,error?.code||error?.message||'BOOKING_FAILED');
    if(error?.code==='INSUFFICIENT_BALANCE')return Response.json({ok:false,code:'INSUFFICIENT_BALANCE',message:'Saldo deposit tidak cukup. Top-up diperlukan sebelum booking diproses.',balance:error.balance},{status:402});
    const status=['QUOTE_NOT_FOUND'].includes(error?.code)?404:['QUOTE_EXPIRED','QUOTE_NOT_APPROVED','QUOTE_FORBIDDEN','QUOTE_BUSY','QUOTE_INVALID'].includes(error?.code)?409:400;
    return Response.json({ok:false,code:error?.code||'BOOKING_ERROR',message:error?.message||'Booking tidak dapat diproses.'},{status});
  }
};

export const config={path:'/.netlify/functions/partner-booking-debit',method:'POST',rateLimit:{windowSize:60,windowLimit:30,aggregateBy:'ip',action:'rate_limit'}};
