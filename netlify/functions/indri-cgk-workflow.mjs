import crypto from 'node:crypto';
import {db,clean,num,json,assertIndriSession,actor,listPrefix,creditGateStatus} from './_indri-cgk-core.mjs';

const loaKey=id=>`loa/${id}`;
const invoiceKey=id=>`invoice/${id}`;
const stockKey=id=>`stock/${id}`;
const openCommitStatuses=new Set(['APPROVED','RECEIVED','PACKED','AIRLINE_BOOKED','SMU_ISSUED','DEPARTED','ARRIVED','RELEASED']);
const activeStockStatuses=new Set(['RECEIVED','PACKING','READY_TO_BOOK','BOOKED','SMU_ISSUED','DEPARTED','ARRIVED']);

function invoiceBalance(inv){
  const paid=(inv.payments||[]).reduce((s,p)=>s+num(p.amount),0);
  return {paid,outstanding:Math.max(0,num(inv.amount)-paid)};
}
function customerFinance(customerId,data){
  const inv=data.invoices.filter(x=>x.customerId===customerId);
  const outstanding=inv.reduce((s,x)=>s+invoiceBalance(x).outstanding,0);
  const committed=data.loas.filter(x=>x.customerId===customerId&&openCommitStatuses.has(x.status)&&!x.invoiceId).reduce((s,x)=>s+num(x.total),0);
  const customer=data.customers.find(x=>x.id===customerId),limit=num(customer?.creditLimit),exposure=outstanding+committed;
  return {outstanding,committed,exposure,availableCredit:Math.max(0,limit-exposure)};
}
function dueDate(invoiceDate,scheme,days){
  const d=new Date(invoiceDate);
  if(scheme==='CREDIT')d.setUTCDate(d.getUTCDate()+Math.max(0,Math.floor(num(days))));
  return d.toISOString().slice(0,10);
}
function rank(s){
  return ({PENDING_APPROVAL:1,APPROVED:2,RECEIVED:3,PACKED:4,AIRLINE_BOOKED:5,SMU_ISSUED:6,DEPARTED:7,ARRIVED:8,RELEASED:9,INVOICED:10,PAID:11})[s]||0;
}
async function allData(){
  const [customers,loas,invoices,stocks]=await Promise.all([
    listPrefix('customer/'),listPrefix('loa/'),listPrefix('invoice/'),listPrefix('stock/')
  ]);
  return {customers,loas,invoices,stocks};
}
function stockSummary(stocks=[]){
  const active=stocks.filter(x=>activeStockStatuses.has(String(x.status||'').toUpperCase()));
  return {
    activeShipments:active.length,
    pieces:active.reduce((s,x)=>s+Math.max(0,Math.floor(num(x.pieces))),0),
    weightKg:+active.reduce((s,x)=>s+Math.max(0,num(x.currentWeightKg||x.receivedWeightKg)),0).toFixed(2),
    atCgk:active.filter(x=>['RECEIVED','PACKING','READY_TO_BOOK','BOOKED','SMU_ISSUED'].includes(String(x.status||'').toUpperCase())).length,
    departed:active.filter(x=>String(x.status||'').toUpperCase()==='DEPARTED').length,
    arrived:active.filter(x=>String(x.status||'').toUpperCase()==='ARRIVED').length
  };
}
function dashboard(data){
  const customers=data.customers.map(c=>({...c,finance:customerFinance(c.id,data),creditGate:creditGateStatus(c,data.invoices)}));
  const stocks=data.stocks.sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  const stockMap=new Map(stocks.map(x=>[x.loaId,x]));
  const loas=data.loas.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map(x=>({
    id:x.id,loaNumber:x.loaNumber,createdAt:x.createdAt,status:x.status,stageRank:rank(x.status),
    customerId:x.customerId,customerName:x.customerName,paymentScheme:x.paymentScheme,pksNumber:x.pksNumber,
    destinationAirport:x.destinationAirport,shipper:x.shipper,consignee:x.consignee,contents:x.contents,pieces:x.pieces,
    actualWeight:x.actualWeight,estimatedChargeableWeight:x.estimatedChargeableWeight,airline:x.airline,total:x.total,pdfUrl:x.pdfUrl,
    approval:x.approval||null,receipt:x.receipt||null,packing:x.packing||null,airlineBooking:x.airlineBooking||null,
    smu:x.smu||null,departure:x.departure||null,arrival:x.arrival||null,release:x.release||null,invoiceId:x.invoiceId||'',
    stock:stockMap.get(x.id)||null
  }));
  const invoices=data.invoices.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map(x=>{
    const bal=invoiceBalance(x);return {...x,paidTotal:bal.paid,outstanding:bal.outstanding};
  });
  return {
    customers,loas,invoices,stocks,
    summary:{
      customerCount:customers.filter(x=>x.active!==false).length,
      pendingApproval:loas.filter(x=>x.status==='PENDING_APPROVAL').length,
      inProcess:loas.filter(x=>rank(x.status)>=2&&rank(x.status)<=9).length,
      unpaidInvoice:invoices.filter(x=>x.outstanding>0).length,
      totalReceivable:invoices.reduce((s,x)=>s+x.outstanding,0),
      stock:stockSummary(stocks)
    }
  };
}
async function saveLoa(loa,request,action){
  loa.updatedAt=new Date().toISOString();
  loa.audit=[...(loa.audit||[]),{at:loa.updatedAt,by:actor(request),action}];
  await db().setJSON(loaKey(loa.id),loa);
}
async function saveStock(stock,request,status,action,extra={}){
  const now=new Date().toISOString();
  stock.status=status;
  stock.updatedAt=now;
  Object.assign(stock,extra);
  stock.audit=[...(stock.audit||[]),{at:now,by:actor(request),status,action}];
  await db().setJSON(stockKey(stock.id),stock);
  return stock;
}
function newStockId(){return `STK-CGK-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${String(Date.now()).slice(-7)}`;}

export default async request=>{
  try{assertIndriSession(request);}catch(e){return json({message:e.message},e.status||401);}
  if(request.method==='GET')return json(dashboard(await allData()));
  if(request.method!=='POST')return json({message:'Metode tidak diizinkan.'},405);

  let b;try{b=await request.json();}catch{return json({message:'Data tidak valid.'},400);}
  const action=clean(b.action,40).toUpperCase(),now=new Date().toISOString(),data=await allData();

  if(action==='APPROVE_LOA'){
    const loa=data.loas.find(x=>x.id===clean(b.loaId,80));
    if(!loa)return json({message:'LoA tidak ditemukan.'},404);
    if(loa.status!=='PENDING_APPROVAL')return json({message:'LoA sudah melewati tahap approval.'},409);
    const customer=data.customers.find(x=>x.id===loa.customerId);
    if(!customer||customer.active===false)return json({message:'Master PT Pengirim tidak aktif.'},409);
    if(customer.pksStatus!=='ACTIVE')return json({message:'PKS belum ACTIVE.'},409);
    if(customer.paymentScheme==='CREDIT'){
      const fin=customerFinance(customer.id,data),available=Math.max(0,num(customer.creditLimit)-fin.outstanding-fin.committed);
      const gate=creditGateStatus(customer,data.invoices);
      if(!gate.active)return json({message:'Fasilitas kredit sedang CREDIT HOLD. Approval LoA ditolak.',code:'CREDIT_HOLD',reasons:gate.reasons},409);
      if(num(loa.total)>available)return json({message:`Plafond kredit tidak cukup. Sisa limit Rp ${Math.round(available).toLocaleString('id-ID')}.`,code:'CREDIT_LIMIT_EXCEEDED'},409);
    }
    loa.status='APPROVED';
    loa.approval={
      approvedAt:clean(b.approvedAt,30)||now,
      approvedBy:clean(b.approvedBy,140)||'Customer',
      approvalRef:clean(b.approvalRef,200),
      notes:clean(b.notes,800),
      requiredDpAmount:customer.paymentScheme==='DP'?Math.round(num(loa.total)*num(customer.dpPercent)/100):0
    };
    await saveLoa(loa,request,'LoA disetujui pelanggan.');
    return json({ok:true,item:loa});
  }

  const loa=data.loas.find(x=>x.id===clean(b.loaId,80));
  if(['RECEIVE_GOODS','PACK_COMPLETE','AIRLINE_BOOK','ISSUE_SMU','MARK_DEPARTED','MARK_ARRIVED','RELEASE_GOODS','ISSUE_INVOICE'].includes(action)&&!loa)return json({message:'LoA tidak ditemukan.'},404);
  let stock=loa?data.stocks.find(x=>x.loaId===loa.id)||null:null;

  if(action==='RECEIVE_GOODS'){
    if(loa.status!=='APPROVED')return json({message:'Barang hanya dapat diterima setelah LoA disetujui.'},409);
    if(stock&&activeStockStatuses.has(String(stock.status||'').toUpperCase()))return json({message:'Stock In Transit untuk LoA ini sudah aktif.'},409);
    const pieces=Math.max(1,Math.floor(num(b.pieces)||num(loa.pieces)));
    const actualWeight=Math.max(.01,num(b.actualWeight)||num(loa.actualWeight));
    const receiptNumber=`PTI/LJL/CGK/${now.slice(0,7).replace('-','')}/${String(Date.now()).slice(-7)}`;
    loa.status='RECEIVED';
    loa.receipt={
      receiptNumber,receivedAt:clean(b.receivedAt,30)||now,receivedBy:clean(b.receivedBy,140)||'Indri',
      pieces,actualWeight,condition:clean(b.condition,300)||'Baik',
      warehouseLocation:clean(b.warehouseLocation,160)||'Gudang CGK / Soetta',
      rackLocation:clean(b.rackLocation,100),notes:clean(b.notes,800)
    };
    stock={
      id:crypto.randomUUID(),stockId:newStockId(),loaId:loa.id,loaNumber:loa.loaNumber,ptiNumber:receiptNumber,
      customerId:loa.customerId,customerName:loa.customerName,shipper:loa.shipper,consignee:loa.consignee,
      originAirport:'CGK',destinationAirport:loa.destinationAirport,contents:loa.contents,
      pieces,receivedWeightKg:actualWeight,currentWeightKg:actualWeight,condition:loa.receipt.condition,
      status:'RECEIVED',custodyStatus:'IN_CUSTODY_LIBRA',locationType:'WAREHOUSE',
      currentLocation:loa.receipt.warehouseLocation,rackLocation:loa.receipt.rackLocation,
      receivedAt:loa.receipt.receivedAt,receivedBy:loa.receipt.receivedBy,createdAt:now,updatedAt:now,
      audit:[{at:now,by:actor(request),status:'RECEIVED',action:'Stock In Transit dibuat dari penerimaan PTI.'}]
    };
    loa.stockId=stock.id;
    await db().setJSON(stockKey(stock.id),stock);
    await saveLoa(loa,request,`Barang diterima. Stock In Transit ${stock.stockId} dibuat.`);
    return json({ok:true,item:loa,stock});
  }

  if(action==='PACK_COMPLETE'){
    if(loa.status!=='RECEIVED')return json({message:'Packing hanya dapat diselesaikan setelah barang diterima.'},409);
    if(!stock)return json({message:'Stock In Transit tidak ditemukan. Terima barang/PTI terlebih dahulu.'},409);
    const pieces=Math.max(1,Math.floor(num(b.pieces)||num(loa.receipt?.pieces)||num(loa.pieces)));
    const actualWeight=Math.max(.01,num(b.actualWeight)||num(loa.receipt?.actualWeight)||num(loa.actualWeight));
    loa.status='PACKED';
    loa.packing={
      packedAt:clean(b.packedAt,30)||now,packedBy:clean(b.packedBy,140)||'Indri',
      pieces,actualWeight,volumeWeight:Math.max(0,num(b.volumeWeight)),
      packingType:clean(b.packingType,120)||'STANDARD',notes:clean(b.notes,800)
    };
    await saveStock(stock,request,'READY_TO_BOOK','Packing selesai; stok siap booking airline.',{
      pieces,currentWeightKg:actualWeight,packingType:loa.packing.packingType,packedAt:loa.packing.packedAt,
      locationType:'WAREHOUSE',currentLocation:stock.currentLocation||'Gudang CGK / Soetta'
    });
    await saveLoa(loa,request,'Proses packing selesai. Stock In Transit → READY_TO_BOOK.');
    return json({ok:true,item:loa,stock});
  }

  if(action==='AIRLINE_BOOK'){
    if(loa.status!=='PACKED')return json({message:'Booking airline hanya dapat dibuat setelah packing selesai.'},409);
    if(!stock)return json({message:'Stock In Transit tidak ditemukan.'},409);
    if(!clean(b.bookingCode,120))return json({message:'Kode booking airline wajib diisi.'},400);
    loa.status='AIRLINE_BOOKED';
    loa.airlineBooking={
      bookedAt:clean(b.bookedAt,30)||now,airline:clean(b.airline,120)||loa.airline||'',
      bookingCode:clean(b.bookingCode,120),flightNumber:clean(b.flightNumber,80),flightDate:clean(b.flightDate,20),
      bookedWeight:Math.max(.01,num(b.bookedWeight)||num(loa.packing?.actualWeight)||num(loa.estimatedChargeableWeight)),
      notes:clean(b.notes,800)
    };
    await saveStock(stock,request,'BOOKED','Booking airline tercatat.',{
      airline:loa.airlineBooking.airline,bookingCode:loa.airlineBooking.bookingCode,
      flightNumber:loa.airlineBooking.flightNumber,flightDate:loa.airlineBooking.flightDate,
      currentWeightKg:loa.airlineBooking.bookedWeight
    });
    await saveLoa(loa,request,'Booking airline tercatat. Stock In Transit → BOOKED.');
    return json({ok:true,item:loa,stock});
  }

  if(action==='ISSUE_SMU'){
    if(loa.status!=='AIRLINE_BOOKED')return json({message:'SMU hanya dapat diterbitkan setelah booking airline.'},409);
    if(!stock)return json({message:'Stock In Transit tidak ditemukan.'},409);
    if(!clean(b.smuNumber,120))return json({message:'Nomor SMU wajib diisi.'},400);
    loa.status='SMU_ISSUED';
    loa.smu={
      smuNumber:clean(b.smuNumber,120),issuedAt:clean(b.issuedAt,30)||now,
      flightNumber:clean(b.flightNumber,80)||loa.airlineBooking?.flightNumber||'',
      chargeableWeight:Math.max(.01,num(b.chargeableWeight)||num(loa.airlineBooking?.bookedWeight)||num(loa.estimatedChargeableWeight)),
      airlineCost:Math.max(0,num(b.airlineCost)),notes:clean(b.notes,800)
    };
    await saveStock(stock,request,'SMU_ISSUED','SMU diterbitkan.',{
      smuNumber:loa.smu.smuNumber,smuIssuedAt:loa.smu.issuedAt,
      flightNumber:loa.smu.flightNumber,currentWeightKg:loa.smu.chargeableWeight
    });
    await saveLoa(loa,request,'SMU diterbitkan. Stock In Transit → SMU_ISSUED.');
    return json({ok:true,item:loa,stock});
  }

  if(action==='MARK_DEPARTED'){
    if(loa.status!=='SMU_ISSUED')return json({message:'Status DEPARTED hanya dapat dicatat setelah SMU terbit.'},409);
    if(!stock)return json({message:'Stock In Transit tidak ditemukan.'},409);
    loa.status='DEPARTED';
    loa.departure={
      departedAt:clean(b.departedAt,30)||now,
      flightNumber:clean(b.flightNumber,80)||loa.smu?.flightNumber||loa.airlineBooking?.flightNumber||'',
      airline:clean(b.airline,120)||loa.airlineBooking?.airline||loa.airline||'',
      originAirport:'CGK',notes:clean(b.notes,800)
    };
    await saveStock(stock,request,'DEPARTED','Barang diserahkan ke airline dan berangkat dari CGK.',{
      custodyStatus:'IN_TRANSIT_AIRLINE',locationType:'AIRLINE_IN_TRANSIT',
      currentLocation:`Dalam penerbangan CGK → ${loa.destinationAirport}`,
      departedAt:loa.departure.departedAt,flightNumber:loa.departure.flightNumber
    });
    await saveLoa(loa,request,'Shipment DEPARTED. Stock In Transit → DEPARTED.');
    return json({ok:true,item:loa,stock});
  }

  if(action==='MARK_ARRIVED'){
    if(loa.status!=='DEPARTED')return json({message:'Status ARRIVED hanya dapat dicatat setelah DEPARTED.'},409);
    if(!stock)return json({message:'Stock In Transit tidak ditemukan.'},409);
    loa.status='ARRIVED';
    loa.arrival={
      arrivedAt:clean(b.arrivedAt,30)||now,destinationAirport:loa.destinationAirport,
      receivedBy:clean(b.receivedBy,140),arrivalReference:clean(b.arrivalReference,160),notes:clean(b.notes,800)
    };
    await saveStock(stock,request,'ARRIVED','Barang tiba di bandara tujuan dan menunggu release/serah terima.',{
      custodyStatus:'ARRIVED_DESTINATION',locationType:'DESTINATION_AIRPORT',
      currentLocation:`Bandara ${loa.destinationAirport}`,arrivedAt:loa.arrival.arrivedAt,
      arrivalReference:loa.arrival.arrivalReference
    });
    await saveLoa(loa,request,'Shipment ARRIVED. Stock In Transit → ARRIVED.');
    return json({ok:true,item:loa,stock});
  }

  if(action==='RELEASE_GOODS'){
    if(loa.status!=='ARRIVED')return json({message:'Barang hanya dapat direlease setelah status ARRIVED.'},409);
    if(!stock)return json({message:'Stock In Transit tidak ditemukan.'},409);
    if(!clean(b.releasedTo,140))return json({message:'Nama penerima/release wajib diisi.'},400);
    loa.status='RELEASED';
    loa.release={
      releasedAt:clean(b.releasedAt,30)||now,releasedTo:clean(b.releasedTo,140),
      recipientIdRef:clean(b.recipientIdRef,120),podReference:clean(b.podReference,160),
      releasedBy:clean(b.releasedBy,140)||'Petugas tujuan',notes:clean(b.notes,800)
    };
    await saveStock(stock,request,'RELEASED','Barang keluar dari custody Libra / airline dan diserahkan.',{
      custodyStatus:'RELEASED',locationType:'RELEASED',currentLocation:'Released / Serah Terima',
      releasedAt:loa.release.releasedAt,releasedTo:loa.release.releasedTo,podReference:loa.release.podReference,
      closedAt:loa.release.releasedAt
    });
    await saveLoa(loa,request,'Barang RELEASED. Stock In Transit ditutup dari custody aktif.');
    return json({ok:true,item:loa,stock});
  }

  if(action==='ISSUE_INVOICE'){
    if(!['SMU_ISSUED','DEPARTED','ARRIVED','RELEASED'].includes(loa.status))return json({message:'Invoice hanya dapat diterbitkan setelah SMU terbit.'},409);
    if(data.invoices.some(x=>x.loaId===loa.id))return json({message:'Invoice untuk LoA ini sudah ada.'},409);
    const customer=data.customers.find(x=>x.id===loa.customerId);
    if(!customer)return json({message:'Master pelanggan tidak ditemukan.'},409);
    const amount=Math.max(0,num(b.amount)||num(loa.total));
    if(amount<=0)return json({message:'Nilai invoice harus lebih dari Rp0.'},400);
    const id=crypto.randomUUID(),invoiceDate=clean(b.invoiceDate,20)||now.slice(0,10);
    const invoice={
      id,invoiceNumber:`INV/LJL/CGK/${invoiceDate.slice(0,7).replace('-','')}/${String(Date.now()).slice(-7)}`,
      loaId:loa.id,loaNumber:loa.loaNumber,stockId:stock?.stockId||'',customerId:customer.id,customerName:customer.legalName,
      pksNumber:customer.pksNumber,paymentScheme:customer.paymentScheme,dpPercent:num(customer.dpPercent),creditDays:num(customer.creditDays),
      invoiceDate,dueDate:clean(b.dueDate,20)||dueDate(invoiceDate,customer.paymentScheme,customer.creditDays),
      amount,requiredDpAmount:customer.paymentScheme==='DP'?Math.round(amount*num(customer.dpPercent)/100):0,
      payments:[],status:'UNPAID',notes:clean(b.notes,1000),createdAt:now,updatedAt:now
    };
    await db().setJSON(invoiceKey(id),invoice);
    loa.invoiceId=id;
    loa.billingStatus='INVOICED';
    await saveLoa(loa,request,`Invoice ${invoice.invoiceNumber} diterbitkan.`);
    return json({ok:true,item:invoice});
  }

  if(action==='RECORD_PAYMENT'){
    const invoice=data.invoices.find(x=>x.id===clean(b.invoiceId,80));
    if(!invoice)return json({message:'Invoice tidak ditemukan.'},404);
    const amount=Math.max(0,num(b.amount));
    if(amount<=0)return json({message:'Nominal pembayaran harus lebih dari Rp0.'},400);
    const bal=invoiceBalance(invoice);
    if(amount>bal.outstanding+1)return json({message:'Pembayaran melebihi saldo tagihan.'},409);
    invoice.payments=[...(invoice.payments||[]),{
      id:crypto.randomUUID(),paidAt:clean(b.paidAt,30)||now,amount,
      method:clean(b.method,80)||'TRANSFER',reference:clean(b.reference,160),
      notes:clean(b.notes,600),recordedBy:actor(request)
    }];
    const next=invoiceBalance(invoice);
    invoice.status=next.outstanding<=0?'PAID':'PARTIAL';
    invoice.updatedAt=now;
    await db().setJSON(invoiceKey(invoice.id),invoice);
    const related=data.loas.find(x=>x.id===invoice.loaId);
    if(related&&invoice.status==='PAID'){
      related.billingStatus='PAID';
      await saveLoa(related,request,`Invoice ${invoice.invoiceNumber} lunas.`);
    }
    return json({ok:true,item:{...invoice,paidTotal:next.paid,outstanding:next.outstanding}});
  }

  return json({message:'Action workflow tidak dikenal.'},400);
};
export const config={path:'/.netlify/functions/indri-cgk-workflow',method:['GET','POST']};
