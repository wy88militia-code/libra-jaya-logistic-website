import crypto from 'node:crypto';
import {db,clean,num,json,assertIndriSession,actor,quotePtp,listPrefix,creditGateStatus} from './_indri-cgk-core.mjs';
const customerKey=id=>`customer/${id}`,partyKey=(t,id)=>`party/${t}/${id}`,loaKey=id=>`loa/${id}`;
const serial=()=>{const d=new Date();return `LOA/LJL/CGK/${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(Date.now()).slice(-7)}`;};
function pub(x){return {id:x.id,loaNumber:x.loaNumber,createdAt:x.createdAt,status:x.status,customerId:x.customerId,customerName:x.customerName,customerPhone:x.customerPhone,pksNumber:x.pksNumber,paymentScheme:x.paymentScheme,dpPercent:x.dpPercent,creditLimitSnapshot:x.creditLimitSnapshot,creditDays:x.creditDays,originAirport:x.originAirport,destinationAirport:x.destinationAirport,shipper:x.shipper,consignee:x.consignee,contents:x.contents,pieces:x.pieces,actualWeight:x.actualWeight,estimatedChargeableWeight:x.estimatedChargeableWeight,airline:x.airline,ratePerKg:x.ratePerKg,total:x.total,validUntil:x.validUntil,pdfUrl:x.pdfUrl};}
async function list(){const {blobs}=await db().list({prefix:'loa/'});const rows=(await Promise.all(blobs.map(x=>db().get(x.key,{type:'json',consistency:'strong'})))).filter(Boolean);return rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map(pub);}
export default async request=>{
  try{assertIndriSession(request);}catch(e){return json({message:e.message},e.status||401);}
  if(request.method==='GET')return json({items:await list()});
  if(request.method!=='POST')return json({message:'Metode tidak diizinkan.'},405);
  let b;try{b=await request.json();}catch{return json({message:'Data tidak valid.'},400);}
  const destinationAirport=clean(b.destinationAirport,10).toUpperCase();
  if(!/^[A-Z]{3}$/.test(destinationAirport)||destinationAirport==='CGK')return json({message:'Bandara tujuan PTP tidak valid.'},400);
  if(!clean(b.contents)||num(b.pieces)<=0||num(b.actualWeight)<=0)return json({message:'Lengkapi barang, koli dan berat.'},400);
  const customer=await db().get(customerKey(clean(b.customerId,80)),{type:'json',consistency:'strong'});
  if(!customer||customer.active===false)return json({message:'Pilih Master PT Pengirim aktif.'},400);
  if(customer.pksStatus!=='ACTIVE')return json({message:'PKS customer harus ACTIVE sebelum LoA dibuat. Draft/Review/Ready for Privy belum dapat dipakai transaksi.'},409);
  if(customer.pksValidUntil&&customer.pksValidUntil<new Date().toISOString().slice(0,10))return json({message:'PKS customer sudah melewati masa berlaku.'},409);
  if(customer.paymentScheme==='CREDIT'){
    const invoices=await listPrefix('invoice/'),gate=creditGateStatus(customer,invoices);
    if(!gate.active){
      const labels={PKS_NOT_ACTIVE:'PKS belum ACTIVE',CREDIT_APPROVAL_NOT_ACTIVE:'Credit Approval belum ACTIVE',OWNER_PG_NOT_ACTIVE:'Personal Guarantee Owner belum ACTIVE',DIRECTOR_PG_NOT_ACTIVE:'Personal Guarantee Direktur Utama belum ACTIVE',OVERDUE_INVOICE:'terdapat invoice overdue'};
      return json({message:'Fasilitas kredit sedang CREDIT HOLD: '+gate.reasons.map(x=>labels[x]||x).join(', ')+'. LoA kredit tidak dapat dibuat.',code:'CREDIT_HOLD',reasons:gate.reasons},409);
    }
  }
  const shipper=await db().get(partyKey('SHIPPER',clean(b.shipperId,80)),{type:'json',consistency:'strong'});
  const consignee=await db().get(partyKey('CONSIGNEE',clean(b.consigneeId,80)),{type:'json',consistency:'strong'});
  if(!shipper||shipper.active===false)return json({message:'Pilih Master Pengirim aktif.'},400);
  if(!consignee||consignee.active===false)return json({message:'Pilih Master Konsinyi aktif.'},400);
  const packages=Array.isArray(b.packages)?b.packages.slice(0,100).map((p,i)=>({piece:i+1,actualWeight:num(p.actualWeight),length:num(p.length),width:num(p.width),height:num(p.height),woodPacking:Boolean(b.woodPacking)})):[];
  const volumeWeight=packages.reduce((s,p)=>s+(p.length>0&&p.width>0&&p.height>0?p.length*p.width*p.height/6000:0),0);
  let pricing;try{pricing=await quotePtp(request,{destinationAirport,actualWeight:num(b.actualWeight),volumeWeight,declaredValue:num(b.declaredValue),promoCode:clean(b.promoCode,40),woodPacking:Boolean(b.woodPacking),packages,insurance:b.insurance!==false});}catch(e){return json({message:e.message||'Harga PTP belum tersedia.',code:e.code||'PRICE_ERROR'},422);}
  const id=crypto.randomUUID(),now=new Date().toISOString(),token=crypto.randomBytes(32).toString('hex');
  const item={id,loaNumber:serial(),createdAt:now,updatedAt:now,status:'PENDING_APPROVAL',preparedBy:actor(request),hub:'CGK',service:'PTP',originAirport:'CGK',destinationAirport,customerId:customer.id,customerCode:customer.customerCode,customerName:customer.legalName,customerPhone:customer.phone,customerEmail:customer.email,pksNumber:customer.pksNumber,pksDate:customer.pksDate,pksValidUntil:customer.pksValidUntil,paymentScheme:customer.paymentScheme,dpPercent:num(customer.dpPercent),creditLimitSnapshot:num(customer.creditLimit),creditDays:num(customer.creditDays),shipperId:shipper.id,shipper:{code:shipper.code,name:shipper.name,company:shipper.company,pic:shipper.pic,phone:shipper.phone,email:shipper.email,address:shipper.address,city:shipper.city,province:shipper.province,airport:shipper.airport||'CGK'},consigneeId:consignee.id,consignee:{code:consignee.code,name:consignee.name,company:consignee.company,pic:consignee.pic,phone:consignee.phone,email:consignee.email,address:consignee.address,city:consignee.city,province:consignee.province,airport:consignee.airport||destinationAirport},contents:clean(b.contents,300),category:clean(b.category,100),pieces:num(b.pieces),packages,actualWeight:num(b.actualWeight),volumeWeight:+volumeWeight.toFixed(2),estimatedChargeableWeight:pricing.billedKg,declaredValue:num(b.declaredValue),woodPacking:Boolean(b.woodPacking),promoCode:clean(b.promoCode,40),airline:pricing.airline?.name||'',airlineRateId:pricing.rateId,ratePerKg:num(pricing.sellRatePerKg),billedKg:num(pricing.billedKg),cargoSubtotal:num(pricing.cargoSubtotal),airlineAdminPerSmu:num(pricing.airlineAdminPerSmu),insurancePremium:num(pricing.insurance),woodPackingPrice:num(pricing.woodPacking),promoDiscount:num(pricing.promoDiscount),ppn:num(pricing.ppn),total:num(pricing.total),priceSource:pricing.source,pricedAt:pricing.capturedAt||now,priceSnapshot:pricing,validUntil:clean(b.validUntil,20),terms:clean(b.terms,1600),publicDocumentToken:token,audit:[{at:now,by:actor(request),action:'LoA PTP CGK dibuat dari JL Master dan menunggu approval.'}]};
  item.pdfUrl=`${new URL(request.url).origin}/.netlify/functions/indri-cgk-loa-pdf?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  await db().setJSON(loaKey(id),item);return json({ok:true,item:pub(item)},201);
};
export const config={path:'/.netlify/functions/indri-cgk-loa',method:['GET','POST']};
