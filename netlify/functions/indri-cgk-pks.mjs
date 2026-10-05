import crypto from 'node:crypto';
import {db,clean,num,json,assertIndriSession,actor} from './_indri-cgk-core.mjs';
const customerKey=id=>`customer/${id}`,pksKey=id=>`pks/${id}`;
function number(){const d=new Date();return `PKS/LJL-CGK/${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(Date.now()).slice(-7)}`;}
function paymentText(c){
  if(c.paymentScheme==='DP')return `DP sebesar ${num(c.dpPercent)}% dari nilai LoA dibayar sesuai ketentuan transaksi; sisa pembayaran mengikuti invoice final.`;
  if(c.paymentScheme==='CREDIT')return `KREDIT dengan plafond maksimum Rp ${Math.round(num(c.creditLimit)).toLocaleString('id-ID')} dan termin ${Math.floor(num(c.creditDays))} hari kalender sejak tanggal invoice. Fasilitas kredit hanya berlaku setelah Credit Approval dan seluruh Personal Guarantee yang diwajibkan berstatus ACTIVE.`;
  return 'CASH: pembayaran dilakukan sesuai invoice transaksi tanpa fasilitas plafond kredit.';
}
function clauses(c){return [
 {title:'PASAL 1 - RUANG LINGKUP',body:[
  'PIHAK PERTAMA menyediakan layanan pengiriman kargo udara Port to Port (PTP) melalui Hub CGK untuk PIHAK KEDUA sesuai rute dan kapasitas layanan yang tersedia.',
  'Layanan tambahan seperti pickup, last-mile, special handling, packing khusus, karantina, dangerous goods, asuransi atau layanan lain hanya berlaku bila dicantumkan pada LoA atau dokumen transaksi terkait.'
 ]},
 {title:'PASAL 2 - MASTER DATA DAN LETTER OF ACCEPTANCE (LoA)',body:[
  'Sebelum melakukan transaksi, PIHAK KEDUA wajib terdaftar dalam Master Pelanggan PIHAK PERTAMA dan menjaga data badan usaha, pengurus, PIC serta penandatangan tetap benar dan mutakhir.',
  'Setiap pengiriman didahului LoA yang memuat sekurang-kurangnya rute, barang, jumlah koli, berat/dimensi, tarif, komponen biaya, skema pembayaran dan ketentuan khusus.',
  'LoA menjadi dasar pelaksanaan setelah disetujui PIHAK KEDUA atau Authorized PIC. Perubahan material setelah persetujuan wajib dicatat dan, apabila mempengaruhi harga atau risiko, dimintakan persetujuan kembali.'
 ]},
 {title:'PASAL 3 - TARIF, BERAT TAGIHAN DAN PAJAK',body:[
  'Tarif menggunakan harga aktif pada saat LoA diterbitkan kecuali disepakati lain secara tertulis.',
  'Berat tagihan mengikuti berat aktual atau berat volume/chargeable weight sesuai ketentuan layanan/airline dan hasil timbang final.',
  'Pajak dan pungutan resmi mengikuti ketentuan yang berlaku pada saat transaksi.'
 ]},
 {title:'PASAL 4 - SKEMA PEMBAYARAN DAN CREDIT GATE',body:[
  paymentText(c),
  'Untuk skema KREDIT, fasilitas kredit bukan hak otomatis PIHAK KEDUA. Credit Approval, Personal Guarantee Owner/Pemegang Saham Pengendali, serta Personal Guarantee Direktur Utama apabila orangnya berbeda, wajib memenuhi status yang ditetapkan PIHAK PERTAMA.',
  'Apabila Owner/Pemegang Saham Pengendali sekaligus menjabat Direktur Utama, satu Personal Guarantee dapat memenuhi kedua persyaratan tersebut.',
  'PIHAK PERTAMA berhak menahan LoA kredit baru apabila terdapat invoice overdue, Credit Hold, Personal Guarantee tidak aktif, Credit Approval tidak aktif, atau exposure telah mencapai batas plafond.'
 ]},
 {title:'PASAL 5 - CREDIT EXPOSURE DAN HARD STOP',body:[
  'Credit Exposure dapat meliputi invoice yang belum lunas, LoA yang telah disetujui namun belum diinvoice, Stock In Transit, serta biaya transaksi yang telah timbul dan dapat ditentukan. Satu kewajiban yang sama tidak dihitung dua kali.',
  'Available Credit dihitung dari plafond dikurangi Credit Exposure setelah memperhitungkan pembayaran yang telah efektif dan terverifikasi.',
  `Sistem dapat memberikan warning pada penggunaan sekitar ${Math.floor(num(c.creditWarningPercent)||80)}% plafond dan menerapkan Hard Stop pada saat exposure mencapai 100% plafond.`
 ]},
 {title:'PASAL 6 - PENERIMAAN BARANG DAN STOCK IN TRANSIT',body:[
  'Penerimaan barang dicatat melalui Surat Terima Barang/PTI dengan jumlah koli, berat, kondisi, lokasi dan catatan penerimaan.',
  'Sejak PTI diterbitkan, barang dicatat sebagai Stock In Transit sampai RELEASED/CLOSED.',
  'Barang dalam Stock In Transit tetap merupakan milik PIHAK KEDUA dan/atau pemilik barang dan tidak otomatis menjadi jaminan atas kewajiban kredit PIHAK KEDUA.'
 ]},
 {title:'PASAL 7 - PACKING, BOOKING AIRLINE DAN SMU',body:[
  'PIHAK PERTAMA berhak melakukan penimbangan/pengukuran ulang dan meminta atau melakukan repacking apabila kemasan tidak memenuhi ketentuan keselamatan atau airline.',
  'Booking airline dilakukan setelah tahapan operasional yang diwajibkan terpenuhi. Jadwal dan space mengikuti konfirmasi airline.',
  'Nomor booking, flight dan SMU dicatat sebagai referensi operasional transaksi.'
 ]},
 {title:'PASAL 8 - INVOICE DAN PEMBAYARAN',body:[
  'Invoice dapat diterbitkan setelah data operasional yang diperlukan tersedia, termasuk SMU dan berat tagihan bila relevan.',
  'Pembayaran dianggap diterima setelah dana efektif masuk ke rekening resmi yang ditunjuk PIHAK PERTAMA dan telah diverifikasi.',
  'Keberatan atas sebagian invoice tidak menunda pembayaran bagian yang tidak disengketakan.'
 ]},
 {title:'PASAL 9 - WANPRESTASI DAN AUTOMATIC CREDIT HOLD',body:[
  'Invoice yang melewati tanggal jatuh tempo dapat secara otomatis berstatus OVERDUE dan fasilitas kredit PIHAK KEDUA berstatus CREDIT HOLD.',
  'Dalam status CREDIT HOLD, transaksi kredit baru diblok dan transaksi baru hanya dapat dilayani dengan CASH atau DP sesuai persetujuan PIHAK PERTAMA.',
  'PIHAK KEDUA juga dapat dianggap wanprestasi apabila memberikan data material yang tidak benar, menggunakan fasilitas tanpa kewenangan, melanggar kewajiban material, atau tidak memenuhi syarat jaminan kredit yang telah disepakati.'
 ]},
 {title:'PASAL 10 - SOMASI, FINAL DEMAND DAN DEFAULT',body:[
  'PIHAK PERTAMA dapat mengirim pemberitahuan overdue, Somasi I dan Final Demand sebagai tahapan penagihan dan dokumentasi wanprestasi.',
  'Apabila kewajiban tetap tidak diselesaikan sampai berakhirnya tenggang dalam Final Demand, status dapat ditetapkan DEFAULT/WANPRESTASI.',
  'Tenggang dalam somasi merupakan mekanisme kontraktual Para Pihak dan tidak membatasi hak hukum PIHAK PERTAMA apabila keadaan memerlukan tindakan lain yang diperbolehkan hukum.'
 ]},
 {title:'PASAL 11 - PERCEPATAN KEWAJIBAN',body:[
  'Dalam keadaan DEFAULT, PIHAK PERTAMA dapat menyatakan kewajiban pembayaran yang telah timbul berdasarkan LoA/transaksi yang telah disetujui dan yang nilainya telah pasti atau dapat ditentukan menjadi segera jatuh tempo, sepanjang diperbolehkan berdasarkan hukum dan perjanjian.',
  'Klausul percepatan tidak digunakan untuk menagih biaya masa depan yang belum timbul dan tidak menimbulkan penghitungan ganda atas kewajiban yang sama.'
 ]},
 {title:'PASAL 12 - PERSONAL GUARANTEE',body:[
  'Untuk fasilitas KREDIT, Personal Guarantee dibuat dalam dokumen tersendiri dan menjadi bagian yang terkait dengan fasilitas kredit PIHAK KEDUA.',
  'Personal Guarantee wajib diberikan oleh Owner/Pemegang Saham Pengendali dan oleh Direktur Utama apabila Direktur Utama merupakan orang yang berbeda.',
  'Personal Guarantee menyebut secara tegas identitas Penjamin, ruang lingkup dan batas kewajiban yang dijamin, jangka waktu, tata cara tuntutan, serta ketentuan pelepasan hak penanggung apabila disepakati.',
  'Penandatanganan Personal Guarantee dilakukan dalam kapasitas pribadi Penjamin dan dipisahkan dari kapasitasnya sebagai pengurus atau wakil PIHAK KEDUA.'
 ]},
 {title:'PASAL 13 - TUNTUTAN KEPADA PERSONAL GUARANTOR',body:[
  'Apabila PIHAK KEDUA berada dalam DEFAULT dan tidak memenuhi Final Demand, PIHAK PERTAMA dapat menyampaikan tuntutan kepada Personal Guarantor sesuai dokumen Personal Guarantee.',
  'Dokumen Personal Guarantee dapat memuat pelepasan hak untuk meminta agar harta debitur terlebih dahulu disita dan dijual, serta apabila terdapat lebih dari satu Penjamin dapat memuat pelepasan hak pembagian tuntutan antarpenjamin, sepanjang diperbolehkan hukum dan dinyatakan secara tegas.',
  'Personal Guarantee tidak membuat kewajiban Penjamin melebihi ruang lingkup kewajiban yang secara tegas dijamin.'
 ]},
 {title:'PASAL 14 - SET-OFF DAN RESTRUKTURISASI',body:[
  'Security deposit, kelebihan pembayaran atau credit balance yang secara sah dapat diperhitungkan dapat digunakan untuk mengurangi kewajiban yang telah jatuh tempo setelah rekonsiliasi dan pencatatan.',
  'PIHAK PERTAMA dapat, tetapi tidak wajib, menyetujui payment plan atau restrukturisasi. Selama restrukturisasi, fasilitas kredit baru tetap dapat ditempatkan dalam CREDIT HOLD.',
  'Penerimaan pembayaran sebagian atau toleransi tidak dianggap sebagai pelepasan sisa kewajiban atau Personal Guarantee kecuali dinyatakan tertulis.'
 ]},
 {title:'PASAL 15 - LEGAL COLLECTION',body:[
  'Apabila setelah Final Demand dan tuntutan kepada Personal Guarantor kewajiban tetap tidak diselesaikan, PIHAK PERTAMA dapat menggunakan kuasa hukum, mediasi, gugatan atau upaya hukum lain yang tersedia.',
  'PIHAK PERTAMA tidak melakukan penyitaan, pengambilan, penjualan atau eksekusi aset secara sepihak di luar prosedur yang diperbolehkan hukum.'
 ]},
 {title:'PASAL 16 - KEWAJIBAN PIHAK KEDUA ATAS BARANG',body:[
  'PIHAK KEDUA wajib memberikan keterangan barang yang benar dan lengkap, termasuk sifat barang, nilai, kandungan baterai/cairan/bahan berbahaya, kebutuhan suhu serta dokumen karantina/izin bila diperlukan.',
  'Barang terlarang, dangerous goods, senjata, amunisi, bahan berbahaya, hewan/tumbuhan/produk perikanan dan barang khusus hanya dapat diproses bila memenuhi ketentuan hukum, airline dan keamanan penerbangan.'
 ]},
 {title:'PASAL 17 - ASURANSI DAN KLAIM',body:[
  'Asuransi diproses berdasarkan nilai barang dan dokumen pendukung yang diwajibkan. Ketentuan pertanggungan, pengecualian dan penyelesaian klaim mengikuti polis/penanggung.',
  'Klaim kehilangan atau kerusakan wajib didukung dokumen yang relevan seperti invoice barang, foto, PTI, SMU dan bukti serah terima.'
 ]},
 {title:'PASAL 18 - KERAHASIAAN, DATA DAN ANTI-FRAUD',body:[
  'Para Pihak menjaga kerahasiaan harga, data customer, pengirim/konsinyi dan informasi komersial nonpublik.',
  'Data dapat digunakan untuk pelaksanaan layanan, billing, credit assessment, monitoring exposure, audit, kepatuhan, penagihan, asuransi, klaim serta fulfillment oleh vendor yang membutuhkan data operasional minimum.',
  'Pembayaran hanya dilakukan ke rekening resmi yang ditunjuk PIHAK PERTAMA. Instruksi perubahan rekening wajib diverifikasi melalui kanal resmi untuk mencegah fraud.'
 ]},
 {title:'PASAL 19 - KEADAAN KAHAR',body:[
  'Keterlambatan atau kegagalan akibat bencana, cuaca ekstrem, gangguan bandara, pembatasan pemerintah, pembatalan penerbangan atau keadaan lain di luar kendali wajar diperlakukan sebagai keadaan kahar sepanjang dapat dibuktikan secara wajar.'
 ]},
 {title:'PASAL 20 - JANGKA WAKTU DAN PENGAKHIRAN',body:[
  'PKS berlaku setelah ditandatangani Para Pihak sampai tanggal berakhir yang tercantum dan dapat diperpanjang berdasarkan kesepakatan.',
  'Pengakhiran tidak menghapus kewajiban pembayaran, kewajiban yang telah timbul, penyelesaian klaim, atau kewajiban penjamin atas kewajiban yang telah tercakup dalam Personal Guarantee.'
 ]},
 {title:'PASAL 21 - HUKUM DAN PERSELISIHAN',body:[
  'PKS tunduk pada hukum Republik Indonesia. Perselisihan diselesaikan terlebih dahulu secara musyawarah dengan itikad baik sebelum menempuh forum hukum yang berwenang.'
 ]},
 {title:'PASAL 22 - TANDA TANGAN ELEKTRONIK',body:[
  'PKS dan dokumen Personal Guarantee dapat ditandatangani secara elektronik menggunakan penyelenggara tanda tangan elektronik tersertifikasi. Audit trail dan sertifikat elektronik menjadi bagian dokumen final.',
  'Pada status DRAFT, REVIEW atau READY_FOR_PRIVY, dokumen belum berlaku. Dokumen baru aktif setelah seluruh penandatangan yang diwajibkan menyelesaikan penandatanganan dan status sistem menjadi ACTIVE.'
 ]},
 {title:'PASAL 23 - PENUTUP',body:[
  'Perubahan material dibuat melalui addendum atau dokumen perubahan yang disetujui Para Pihak.',
  'Tidak digunakannya suatu hak pada suatu waktu tidak dianggap sebagai pelepasan hak tersebut untuk waktu berikutnya kecuali dinyatakan secara tertulis.',
  'PKS dibuat untuk dilaksanakan dengan itikad baik oleh Para Pihak.'
 ]}
];}
function publicItem(x){return {id:x.id,customerId:x.customerId,pksNumber:x.pksNumber,version:x.version,status:x.status,generatedAt:x.generatedAt,updatedAt:x.updatedAt,pdfUrl:x.pdfUrl,privyStatus:x.privyStatus};}
export default async request=>{
  try{assertIndriSession(request);}catch(e){return json({message:e.message},e.status||401);}
  const url=new URL(request.url);
  if(request.method==='GET'){const customerId=clean(url.searchParams.get('customerId'),80);if(!customerId)return json({message:'customerId wajib.'},400);const c=await db().get(customerKey(customerId),{type:'json',consistency:'strong'});if(!c)return json({message:'Customer tidak ditemukan.'},404);if(!c.pksDraftId)return json({item:null});const item=await db().get(pksKey(c.pksDraftId),{type:'json',consistency:'strong'});return json({item:item?publicItem(item):null});}
  if(request.method!=='POST')return json({message:'Metode tidak diizinkan.'},405);
  let b;try{b=await request.json();}catch{return json({message:'Data tidak valid.'},400);}
  const action=clean(b.action,40).toUpperCase(),customerId=clean(b.customerId,80),customer=await db().get(customerKey(customerId),{type:'json',consistency:'strong'});
  if(!customer)return json({message:'Master PT Pengirim tidak ditemukan.'},404);
  if(customer.active===false)return json({message:'Customer nonaktif tidak dapat dibuatkan PKS.'},409);
  const now=new Date().toISOString();
  if(['GENERATE','REGENERATE'].includes(action)){
    const existing=customer.pksDraftId?await db().get(pksKey(customer.pksDraftId),{type:'json',consistency:'strong'}):null,id=existing?.id||crypto.randomUUID(),pksNumber=customer.pksNumber||existing?.pksNumber||number(),version=(existing?.version||0)+1,token=crypto.randomBytes(32).toString('hex');
    const item={id,customerId:customer.id,pksNumber,version,status:'DRAFT',templateVersion:'LJL-PKS-CREDIT-V2',generatedAt:existing?.generatedAt||now,updatedAt:now,privyStatus:'NOT_CONNECTED',firstParty:{legalName:'PT LIBRA JAYA LOGISTIK',domicile:'Kabupaten Jayapura, Papua',signatoryName:'Wahyudi Utomo',signatoryTitle:'Direktur Utama'},secondParty:{legalName:customer.legalName,tradeName:customer.tradeName,nib:customer.nib,npwp:customer.npwp,address:customer.address,pic:customer.pic,phone:customer.phone,email:customer.email,signatoryName:customer.signatoryName||customer.pic,signatoryTitle:customer.signatoryTitle||'Penandatangan yang berwenang (draft)'},commercial:{paymentScheme:customer.paymentScheme,dpPercent:num(customer.dpPercent),creditLimit:num(customer.creditLimit),creditDays:num(customer.creditDays),creditWarningPercent:num(customer.creditWarningPercent)||80,creditApprovalStatus:customer.creditApprovalStatus,ownerPgStatus:customer.ownerPgStatus,directorPgStatus:customer.directorPgStatus,directorSameAsOwner:Boolean(customer.directorSameAsOwner)},guarantors:{owner:{name:customer.ownerName,nik:customer.ownerNik,phone:customer.ownerPhone,email:customer.ownerEmail},director:customer.directorSameAsOwner?null:{name:customer.directorName,nik:customer.directorNik,phone:customer.directorPhone,email:customer.directorEmail}},effectiveDate:customer.pksDate||'',validUntil:customer.pksValidUntil||'',clauses:clauses(customer),publicDocumentToken:token,audit:[...(existing?.audit||[]),{at:now,by:actor(request),action:`Draft PKS versi ${version} dibuat. Belum berlaku dan belum ditandatangani.`}]};
    item.pdfUrl=`${new URL(request.url).origin}/.netlify/functions/indri-cgk-pks-pdf?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
    await db().setJSON(pksKey(id),item);Object.assign(customer,{pksNumber,pksStatus:'DRAFT',pksDraftId:id,pksDraftVersion:version,pksDraftPdfUrl:item.pdfUrl,updatedAt:now});await db().setJSON(customerKey(customer.id),customer);return json({ok:true,item:publicItem(item)},201);
  }
  if(!customer.pksDraftId)return json({message:'Draft PKS belum dibuat.'},409);
  const item=await db().get(pksKey(customer.pksDraftId),{type:'json',consistency:'strong'});if(!item)return json({message:'Draft PKS tidak ditemukan.'},404);
  if(action==='SET_REVIEW'){if(!customer.signatoryName||!customer.signatoryTitle)return json({message:'Nama dan jabatan penandatangan wajib diisi.'},409);item.status='REVIEW';customer.pksStatus='REVIEW';}
  else if(action==='READY_FOR_PRIVY'){if(item.status!=='REVIEW')return json({message:'PKS harus melalui REVIEW terlebih dahulu.'},409);item.status='READY_FOR_PRIVY';customer.pksStatus='READY_FOR_PRIVY';}
  else if(action==='BACK_TO_DRAFT'){item.status='DRAFT';customer.pksStatus='DRAFT';}
  else return json({message:'Action PKS tidak dikenal.'},400);
  item.updatedAt=now;item.audit=[...(item.audit||[]),{at:now,by:actor(request),action:`Status PKS → ${item.status}.`}];customer.updatedAt=now;await db().setJSON(pksKey(item.id),item);await db().setJSON(customerKey(customer.id),customer);return json({ok:true,item:publicItem(item)});
};
export const config={path:'/.netlify/functions/indri-cgk-pks',method:['GET','POST']};
