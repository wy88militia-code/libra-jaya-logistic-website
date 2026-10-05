import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {db,clean} from './_indri-cgk-core.mjs';

const safe=v=>String(v??'').replace(/[\r\n]+/g,' ').normalize('NFKD').replace(/[^\x20-\x7E\xA0-\xFF]/g,'-').trim();
const money=v=>`Rp ${Math.round(Number(v)||0).toLocaleString('id-ID')}`;
function wrap(value,font,size,width){
  const words=(safe(value)||'-').split(/\s+/),lines=[];let line='';
  for(const w of words){const c=line?`${line} ${w}`:w;if(font.widthOfTextAtSize(c,size)<=width)line=c;else{if(line)lines.push(line);line=w;}}
  if(line)lines.push(line);return lines;
}
export default async request=>{
  if(request.method!=='GET')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
  const u=new URL(request.url),customerId=clean(u.searchParams.get('customerId'),80),type=clean(u.searchParams.get('type'),20).toUpperCase(),token=clean(u.searchParams.get('token'),80);
  if(!customerId||!['OWNER','DIRECTOR'].includes(type)||!/^[0-9a-f]{64}$/.test(token))return Response.json({message:'Tautan Personal Guarantee tidak valid.'},{status:400});
  const q=await db().get(`pg/${customerId}/${type}`,{type:'json',consistency:'strong'});
  if(!q||q.publicDocumentToken!==token)return Response.json({message:'Personal Guarantee tidak ditemukan.'},{status:404});

  const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy=rgb(.03,.17,.31),red=rgb(.8,.12,.12),grey=rgb(.38,.44,.5),line=rgb(.84,.87,.9);
  let page,y;const margin=46,width=503;
  function newPage(){
    page=pdf.addPage([595.28,841.89]);
    page.drawText('PT LIBRA JAYA LOGISTIK',{x:margin,y:807,size:11,font:bold,color:navy});
    page.drawText(`${q.status} - PERSONAL GUARANTEE - BELUM BERLAKU JIKA BELUM ACTIVE`,{x:margin,y:789,size:8.3,font:bold,color:red});
    page.drawLine({start:{x:margin,y:780},end:{x:549,y:780},thickness:.7,color:line});y=758;
  }
  function ensure(h){if(y-h<62)newPage();}
  function para(text,indent=0){
    const lines=wrap(text,regular,9.2,width-indent),h=lines.length*12.2+8;ensure(h);
    lines.forEach((t,i)=>page.drawText(t,{x:margin+indent,y:y-i*12.2,size:9.2,font:regular}));y-=h;
  }
  function heading(text){ensure(28);page.drawText(safe(text),{x:margin,y,size:10.2,font:bold,color:navy});y-=20;}
  function row(label,value){
    const lines=wrap(value,regular,9,350),h=Math.max(24,lines.length*12+8);ensure(h);
    page.drawRectangle({x:margin,y:y-h+5,width,height:h,borderColor:line,borderWidth:.5});
    page.drawText(safe(label),{x:54,y:y-10,size:8.5,font:bold,color:navy});
    lines.forEach((t,i)=>page.drawText(t,{x:190,y:y-10-i*12,size:9,font:regular}));y-=h;
  }

  newPage();
  page.drawText('PERSONAL GUARANTEE AGREEMENT',{x:margin,y,size:17,font:bold,color:navy});y-=24;
  page.drawText(type==='OWNER'?'OWNER / PEMEGANG SAHAM PENGENDALI':'DIREKTUR UTAMA',{x:margin,y,size:11.5,font:bold,color:navy});y-=22;
  page.drawText(safe(q.pgNumber),{x:margin,y,size:10,font:regular,color:grey});y-=28;

  row('Status / Versi',`${q.status} / V${q.version||1}`);
  row('Kreditur',q.creditor?.legalName||'PT LIBRA JAYA LOGISTIK');
  row('Debitur / Customer',q.debtor?.legalName||'-');
  row('PKS',q.debtor?.pksNumber||'-');
  row('Penjamin',`${q.guarantor?.name||'-'} - ${q.guarantor?.role||'-'}`);
  row('NIK Penjamin',q.guarantor?.nik||'-');
  row('Kontak',`${q.guarantor?.phone||'-'} / ${q.guarantor?.email||'-'}`);
  row('Alamat',q.guarantor?.address||'-');
  row('Batas Maksimum PG',money(q.creditLimit));
  row('Termin Fasilitas',`${q.creditDays||0} hari kalender`);
  y-=10;
  para('PENJAMIN menyatakan memahami bahwa dokumen ini merupakan penanggungan pribadi yang terpisah dari penandatanganan PKS atas nama badan usaha.');

  for(const clause of q.clauses||[]){heading(clause.title);(clause.body||[]).forEach((p,i)=>para(`${i+1}. ${p}`,8));}

  heading('HALAMAN PERSETUJUAN');
  para('Dokumen ini belum berlaku apabila status masih DRAFT, REVIEW, atau READY_FOR_PRIVY. Aktivasi hanya dilakukan setelah bukti tanda tangan final terverifikasi.');
  ensure(175);
  const top=y;
  page.drawText('PENJAMIN - KAPASITAS PRIBADI',{x:margin,y:top,size:9,font:bold,color:navy});
  page.drawRectangle({x:margin,y:top-95,width:220,height:60,borderColor:line,borderWidth:.7});
  page.drawText(safe(q.guarantor?.name||'-'),{x:margin,y:top-113,size:8.5,font:bold});
  page.drawText(safe(q.guarantor?.role||'-'),{x:margin,y:top-126,size:8,font:regular,color:grey});
  if(q.guarantor?.spouseName){
    page.drawText('ACKNOWLEDGMENT PASANGAN (JIKA RELEVAN)',{x:320,y:top,size:8.5,font:bold,color:navy});
    page.drawRectangle({x:320,y:top-95,width:185,height:60,borderColor:line,borderWidth:.7});
    page.drawText(safe(q.guarantor.spouseName),{x:320,y:top-113,size:8.5,font:bold});
  }

  const pages=pdf.getPages();
  pages.forEach((p,i)=>{
    p.drawLine({start:{x:margin,y:44},end:{x:549,y:44},thickness:.5,color:line});
    p.drawText(`PG ${safe(q.pgNumber)} | V${q.version||1} | Halaman ${i+1}/${pages.length}`,{x:margin,y:29,size:7.4,font:regular,color:grey});
  });
  const bytes=await pdf.save();
  return new Response(bytes,{headers:{
    'content-type':'application/pdf',
    'content-disposition':`inline; filename="DRAFT-PG-${safe(q.pgNumber).replace(/[^a-zA-Z0-9_-]/g,'-')}-V${q.version||1}.pdf"`,
    'cache-control':'private, max-age=120','x-content-type-options':'nosniff'
  }});
};
export const config={path:'/.netlify/functions/indri-cgk-pg-pdf',method:['GET']};
