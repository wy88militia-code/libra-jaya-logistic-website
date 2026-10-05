import crypto from 'node:crypto';
import {db,clean,num,json,assertIndriSession,actor} from './_indri-cgk-core.mjs';

const customerKey=id=>`customer/${id}`;
const pgKey=(customerId,type)=>`pg/${customerId}/${type}`;
const allowedTypes=new Set(['OWNER','DIRECTOR']);
const statusField=type=>type==='OWNER'?'ownerPgStatus':'directorPgStatus';
const docField=type=>type==='OWNER'?'ownerPgDocument':'directorPgDocument';

function serial(type){
  const d=new Date();
  return `PG/${type==='OWNER'?'OWN':'DIR'}/LJL-CGK/${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(Date.now()).slice(-7)}`;
}
function guarantor(customer,type){
  if(type==='OWNER')return {
    type,role:'Owner/Pemegang Saham Pengendali',name:customer.ownerName,nik:customer.ownerNik,
    phone:customer.ownerPhone,email:customer.ownerEmail,address:customer.ownerAddress,
    spouseName:customer.ownerSpouseName,spouseNik:customer.ownerSpouseNik
  };
  return {
    type,role:'Direktur Utama',name:customer.directorName,nik:customer.directorNik,
    phone:customer.directorPhone,email:customer.directorEmail,address:customer.directorAddress
  };
}
function clauses(customer,g,type){
  const multiple=!customer.directorSameAsOwner;
  return [
    {title:'1. PERNYATAAN PENANGGUNGAN',body:[
      `PENJAMIN dengan ini secara tegas memberikan penanggungan pribadi atas kewajiban pembayaran ${customer.legalName} kepada PT Libra Jaya Logistik yang timbul dari fasilitas kredit berdasarkan PKS dan transaksi yang sah.`,
      'Penanggungan ini dibuat secara tertulis, sadar, dan dalam kapasitas pribadi PENJAMIN, terpisah dari kapasitas PENJAMIN sebagai pemegang saham, pengurus, atau wakil perusahaan.'
    ]},
    {title:'2. KEWAJIBAN YANG DIJAMIN',body:[
      'Kewajiban yang dijamin meliputi invoice yang telah jatuh tempo, kewajiban transaksi/LoA yang telah disetujui dan telah timbul serta dapat ditentukan nilainya, dan biaya penagihan yang sah apabila secara tegas diperjanjikan.',
      'Penanggungan tidak mencakup biaya masa depan yang belum timbul dan tidak menyebabkan penghitungan ganda atas kewajiban yang sama.'
    ]},
    {title:'3. BATAS MAKSIMUM PENANGGUNGAN',body:[
      `Batas maksimum penanggungan berdasarkan dokumen ini adalah Rp ${Math.round(num(customer.creditLimit)).toLocaleString('id-ID')}, kecuali Para Pihak secara tertulis menyepakati perubahan batas tersebut.`,
      'Tanggung jawab PENJAMIN tidak boleh melebihi ruang lingkup kewajiban yang secara tegas dijamin dalam dokumen ini.'
    ]},
    {title:'4. WANPRESTASI DAN TUNTUTAN',body:[
      'Tuntutan kepada PENJAMIN dapat dilakukan apabila Debitur/PIHAK KEDUA telah berada dalam kondisi DEFAULT/WANPRESTASI sesuai PKS dan kewajiban yang ditagih belum diselesaikan setelah Final Demand sesuai mekanisme yang berlaku.',
      'Tuntutan kepada PENJAMIN harus menyebut dasar transaksi, jumlah yang ditagih, dan referensi dokumen pendukung.'
    ]},
    {title:'5. PELEPASAN HAK ISTIMEWA PENANGGUNG',body:[
      'Sepanjang diperbolehkan hukum, PENJAMIN secara tegas melepaskan hak untuk meminta agar harta Debitur terlebih dahulu disita dan dijual sebelum tuntutan pembayaran diajukan kepada PENJAMIN.',
      multiple?'Karena terdapat lebih dari satu Personal Guarantor, PENJAMIN juga secara tegas melepaskan hak untuk meminta pembagian tuntutan antarpenjamin, sepanjang diperbolehkan hukum dan sesuai ruang lingkup kewajiban masing-masing.':'Ketentuan pembagian tuntutan antarpenjamin tidak berlaku karena dokumen ini tidak mengasumsikan adanya Penjamin lain selain yang secara terpisah didaftarkan.'
    ]},
    {title:'6. CONTINUING GUARANTEE',body:[
      'Penanggungan berlaku terhadap kewajiban yang timbul selama fasilitas kredit masih aktif sampai kewajiban yang tercakup telah diselesaikan.',
      'Pengakhiran PKS, perubahan jabatan, atau berhentinya PENJAMIN sebagai Owner/Direktur tidak otomatis menghapus penanggungan terhadap kewajiban yang telah timbul sebelum efektifnya pelepasan tertulis oleh PT Libra Jaya Logistik.'
    ]},
    {title:'7. TOLERANSI DAN RESTRUKTURISASI',body:[
      'Penerimaan pembayaran sebagian, pemberian tenggang, restrukturisasi, atau tidak digunakannya suatu hak pada suatu waktu tidak dianggap sebagai pelepasan Personal Guarantee kecuali dinyatakan secara tertulis.',
      'Perubahan material yang memperluas tanggung jawab PENJAMIN di luar batas dokumen ini memerlukan persetujuan PENJAMIN apabila diwajibkan hukum.'
    ]},
    {title:'8. HARTA PERKAWINAN',body:[
      'Apabila relevan terhadap harta bersama perkawinan, PT Libra Jaya Logistik dapat meminta acknowledgment/consent pasangan sebagai dokumen pendukung terpisah.',
      'Tidak adanya acknowledgment pasangan tidak ditafsirkan dalam dokumen ini sebagai pernyataan mengenai status atau dapat tidaknya suatu aset tertentu dieksekusi.'
    ]},
    {title:'9. HUKUM DAN PENYELESAIAN',body:[
      'Dokumen ini tunduk pada hukum Republik Indonesia. Perselisihan diselesaikan terlebih dahulu melalui musyawarah dan, jika tidak terselesaikan, melalui forum hukum yang berwenang.'
    ]},
    {title:'10. TANDA TANGAN ELEKTRONIK',body:[
      'Dokumen ini dapat ditandatangani menggunakan Tanda Tangan Elektronik Tersertifikasi. Audit trail dan sertifikat elektronik menjadi bagian dari dokumen final.',
      'Status DRAFT, REVIEW atau READY_FOR_PRIVY belum menjadikan Personal Guarantee aktif. Personal Guarantee baru berstatus ACTIVE setelah penandatanganan final terverifikasi.'
    ]}
  ];
}
function pub(x){return {id:x.id,customerId:x.customerId,type:x.type,pgNumber:x.pgNumber,status:x.status,version:x.version,pdfUrl:x.pdfUrl,generatedAt:x.generatedAt,updatedAt:x.updatedAt,privyStatus:x.privyStatus};}

export default async request=>{
  let session;
  try{session=assertIndriSession(request);}catch(e){return json({message:e.message},e.status||401);}
  const u=new URL(request.url);
  if(request.method==='GET'){
    const customerId=clean(u.searchParams.get('customerId'),80),type=clean(u.searchParams.get('type'),20).toUpperCase();
    if(!customerId||!allowedTypes.has(type))return json({message:'customerId dan type OWNER/DIRECTOR wajib.'},400);
    const item=await db().get(pgKey(customerId,type),{type:'json',consistency:'strong'});
    return json({item:item?pub(item):null});
  }
  if(request.method!=='POST')return json({message:'Metode tidak diizinkan.'},405);
  let b;try{b=await request.json();}catch{return json({message:'Data tidak valid.'},400);}
  const customerId=clean(b.customerId,80),type=clean(b.type,20).toUpperCase(),action=clean(b.action,40).toUpperCase();
  if(!customerId||!allowedTypes.has(type))return json({message:'customerId dan type OWNER/DIRECTOR wajib.'},400);
  const customer=await db().get(customerKey(customerId),{type:'json',consistency:'strong'});
  if(!customer)return json({message:'Customer tidak ditemukan.'},404);
  if(customer.paymentScheme!=='CREDIT')return json({message:'Personal Guarantee hanya digunakan untuk customer KREDIT.'},409);
  if(type==='DIRECTOR'&&customer.directorSameAsOwner)return json({message:'PG Direktur tidak diperlukan karena Owner sekaligus Direktur Utama.'},409);
  const g=guarantor(customer,type);
  if(!g.name||!g.nik||!g.phone)return json({message:'Data Penjamin belum lengkap di Master Kredit.'},409);
  const existing=await db().get(pgKey(customerId,type),{type:'json',consistency:'strong'});
  const now=new Date().toISOString();

  if(['GENERATE','REGENERATE'].includes(action)){
    const id=existing?.id||crypto.randomUUID(),version=(existing?.version||0)+1,token=crypto.randomBytes(32).toString('hex');
    const item={
      id,customerId,type,pgNumber:existing?.pgNumber||serial(type),version,status:'DRAFT',templateVersion:'LJL-PG-V1',
      generatedAt:existing?.generatedAt||now,updatedAt:now,privyStatus:'NOT_CONNECTED',
      creditor:{legalName:'PT LIBRA JAYA LOGISTIK',signatoryName:'Wahyudi Utomo',signatoryTitle:'Direktur Utama'},
      debtor:{legalName:customer.legalName,customerCode:customer.customerCode,pksNumber:customer.pksNumber},
      guarantor:g,creditLimit:num(customer.creditLimit),creditDays:num(customer.creditDays),clauses:clauses(customer,g,type),
      publicDocumentToken:token,audit:[...(existing?.audit||[]),{at:now,by:actor(request),action:`Draft Personal Guarantee ${type} V${version} dibuat.`}]
    };
    item.pdfUrl=`${new URL(request.url).origin}/.netlify/functions/indri-cgk-pg-pdf?customerId=${encodeURIComponent(customerId)}&type=${type}&token=${token}`;
    await db().setJSON(pgKey(customerId,type),item);
    customer[statusField(type)]='DRAFT';customer[docField(type)]={pgNumber:item.pgNumber,version:item.version,pdfUrl:item.pdfUrl};
    customer.updatedAt=now;await db().setJSON(customerKey(customerId),customer);
    return json({ok:true,item:pub(item)},201);
  }
  if(!existing)return json({message:'Draft Personal Guarantee belum dibuat.'},409);
  if(action==='SET_REVIEW')existing.status='REVIEW';
  else if(action==='READY_FOR_PRIVY'){
    if(existing.status!=='REVIEW')return json({message:'Personal Guarantee harus melalui REVIEW terlebih dahulu.'},409);
    existing.status='READY_FOR_PRIVY';
  } else if(action==='BACK_TO_DRAFT')existing.status='DRAFT';
  else if(action==='MARK_SIGNED_ACTIVE'){
    if(String(session.role||'').toUpperCase()!=='SUPERADMIN')return json({message:'Hanya Super Admin yang dapat mengaktifkan PG yang sudah ditandatangani.'},403);
    if(!clean(b.signatureReference,240))return json({message:'Referensi bukti tanda tangan wajib diisi.'},400);
    existing.status='ACTIVE';existing.privyStatus='SIGNED_VERIFIED';existing.signatureReference=clean(b.signatureReference,240);existing.signedAt=clean(b.signedAt,40)||now;
  } else if(action==='SUSPEND'){
    if(String(session.role||'').toUpperCase()!=='SUPERADMIN')return json({message:'Hanya Super Admin yang dapat menangguhkan PG.'},403);
    existing.status='SUSPENDED';
  } else return json({message:'Action Personal Guarantee tidak dikenal.'},400);

  existing.updatedAt=now;
  existing.audit=[...(existing.audit||[]),{at:now,by:actor(request),action:`Status Personal Guarantee ${type} → ${existing.status}.`}];
  await db().setJSON(pgKey(customerId,type),existing);
  customer[statusField(type)]=existing.status;customer[docField(type)]={pgNumber:existing.pgNumber,version:existing.version,pdfUrl:existing.pdfUrl};
  customer.updatedAt=now;await db().setJSON(customerKey(customerId),customer);
  return json({ok:true,item:pub(existing)});
};
export const config={path:'/.netlify/functions/indri-cgk-pg',method:['GET','POST']};
