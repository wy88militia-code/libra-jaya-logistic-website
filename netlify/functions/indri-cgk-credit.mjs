import {db,clean,json,assertIndriSession,actor,listPrefix,creditGateStatus} from './_indri-cgk-core.mjs';

const customerKey=id=>`customer/${id}`;

export default async request=>{
  let session;
  try{session=assertIndriSession(request);}catch(e){return json({message:e.message},e.status||401);}
  const u=new URL(request.url);

  if(request.method==='GET'){
    const customerId=clean(u.searchParams.get('customerId'),80);
    if(!customerId)return json({message:'customerId wajib.'},400);
    const [customer,invoices]=await Promise.all([
      db().get(customerKey(customerId),{type:'json',consistency:'strong'}),
      listPrefix('invoice/')
    ]);
    if(!customer)return json({message:'Customer tidak ditemukan.'},404);
    const gate=creditGateStatus(customer,invoices);
    return json({item:{
      customerId:customer.id,paymentScheme:customer.paymentScheme,creditApprovalStatus:customer.creditApprovalStatus,
      ownerPgStatus:customer.ownerPgStatus,directorPgStatus:customer.directorPgStatus,
      directorSameAsOwner:Boolean(customer.directorSameAsOwner),gate
    }});
  }

  if(request.method!=='POST')return json({message:'Metode tidak diizinkan.'},405);
  if(String(session.role||'').toUpperCase()!=='SUPERADMIN')return json({message:'Hanya Super Admin yang dapat mengubah Credit Approval.'},403);

  let b;try{b=await request.json();}catch{return json({message:'Data tidak valid.'},400);}
  const customerId=clean(b.customerId,80),action=clean(b.action,40).toUpperCase();
  const customer=await db().get(customerKey(customerId),{type:'json',consistency:'strong'});
  if(!customer)return json({message:'Customer tidak ditemukan.'},404);
  if(customer.paymentScheme!=='CREDIT')return json({message:'Customer ini tidak menggunakan skema KREDIT.'},409);

  const now=new Date().toISOString();
  customer.creditAudit=[...(customer.creditAudit||[])];
  if(action==='APPROVE_CREDIT'){
    if(customer.pksStatus!=='ACTIVE')return json({message:'PKS harus ACTIVE sebelum Credit Approval diaktifkan.'},409);
    customer.creditApprovalStatus='ACTIVE';
    customer.creditApprovedAt=clean(b.approvedAt,40)||now;
    customer.creditApprovedBy=actor(request);
    customer.creditApprovalNotes=clean(b.notes,1000);
    customer.creditAudit.push({at:now,by:actor(request),action:'CREDIT_APPROVAL_ACTIVE',notes:customer.creditApprovalNotes});
  } else if(action==='HOLD_CREDIT'){
    customer.creditApprovalStatus='HOLD';
    customer.creditHoldAt=now;
    customer.creditHoldReason=clean(b.reason,500)||'Manual hold oleh Super Admin.';
    customer.creditAudit.push({at:now,by:actor(request),action:'CREDIT_APPROVAL_HOLD',reason:customer.creditHoldReason});
  } else if(action==='REACTIVATE_CREDIT'){
    if(customer.pksStatus!=='ACTIVE')return json({message:'PKS belum ACTIVE.'},409);
    if(customer.ownerPgStatus!=='ACTIVE')return json({message:'Personal Guarantee Owner belum ACTIVE.'},409);
    if(!customer.directorSameAsOwner&&customer.directorPgStatus!=='ACTIVE')return json({message:'Personal Guarantee Direktur Utama belum ACTIVE.'},409);
    const invoices=await listPrefix('invoice/'),gateBefore=creditGateStatus({...customer,creditApprovalStatus:'ACTIVE'},invoices);
    if(gateBefore.reasons.includes('OVERDUE_INVOICE'))return json({message:'Masih terdapat invoice overdue. Credit Hold tidak dapat dicabut.'},409);
    customer.creditApprovalStatus='ACTIVE';
    customer.creditHoldReason='';customer.creditReactivatedAt=now;
    customer.creditAudit.push({at:now,by:actor(request),action:'CREDIT_REACTIVATED'});
  } else return json({message:'Action Credit Approval tidak dikenal.'},400);

  customer.updatedAt=now;
  await db().setJSON(customerKey(customer.id),customer);
  const invoices=await listPrefix('invoice/');
  return json({ok:true,item:{customerId:customer.id,creditApprovalStatus:customer.creditApprovalStatus,gate:creditGateStatus(customer,invoices)}});
};
export const config={path:'/.netlify/functions/indri-cgk-credit',method:['GET','POST']};
