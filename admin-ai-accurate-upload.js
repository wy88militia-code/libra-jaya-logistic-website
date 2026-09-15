const form=document.querySelector('#statementForm'),statusBox=document.querySelector('#uploadStatus'),resultBox=document.querySelector('#statementResult');
const rp=value=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value)||0);
const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
function setStatus(message,kind='info'){statusBox.className='uploadstatus '+kind;statusBox.textContent=message;statusBox.hidden=false;}
async function imageToJpeg(file){
  if(!/^image\//.test(file.type))return file;
  const mustConvert=/hei[cf]/i.test(file.type)||/\.hei[cf]$/i.test(file.name)||file.size>1200000;
  if(!mustConvert)return file;
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
    const max=1800,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.84));
    if(!blob)throw new Error('Konversi foto gagal.');
    return new File([blob],file.name.replace(/\.[^.]+$/,'.jpg'),{type:'image/jpeg'});
  }catch{
    if(/hei[cf]/i.test(file.type)||/\.hei[cf]$/i.test(file.name))throw new Error('Foto HEIC tidak dapat dikonversi oleh browser ini. Di iPhone pilih Camera > Formats > Most Compatible, lalu foto ulang.');
    return file;
  }finally{URL.revokeObjectURL(url);}
}
function reconciliationHtml(record){
  const r=record.reconciliation;if(!r)return '';
  const s=r.summary||{},rows=(r.rows||[]).map(row=>'<tr class="'+(row.needsReview?'warnrow':'')+'"><td>'+esc(row.date||'—')+'</td><td>'+rp(row.amount)+'</td><td><b>'+esc(row.status)+'</b><small>'+esc(row.reason||'')+'</small></td><td>'+esc((row.invoiceCandidates||[]).map(x=>(x.number||x.id)+' • '+rp(x.amount)+' • '+(x.date||'—')).join(' | ')||'—')+'</td><td>'+Math.round((row.confidence||0)*100)+'%</td></tr>').join('');
  return '<section class="reconcilebox"><h3>Rekonsiliasi Penerimaan Penjualan Lion Parcel</h3><p>Nama pengirim tidak wajib. Acuan utama: nominal tepat, tanggal ±2 hari, faktur belum dipakai, lalu review akuntan.</p><div class="summary"><div><small>Kredit Bank</small><b>'+esc(s.creditTransactionCount||0)+'</b></div><div><small>Total Kredit</small><b>'+rp(s.totalCredit)+'</b></div><div><small>Perlu Review</small><b>'+esc(s.needsReview||0)+'</b></div><div><small>Unmatched</small><b>'+esc(s.unmatched||0)+'</b></div></div><div class="scrollhint">Geser tabel ke kiri/kanan untuk melihat semua kolom.</div><div class="tablewrap"><table class="match-table"><thead><tr><th>Tanggal</th><th>Kredit Bank</th><th>Status/Alasan</th><th>Kandidat Faktur Accurate</th><th>Skor</th></tr></thead><tbody>'+rows+'</tbody></table></div><small>Hasil ini hanya rekomendasi rule-based. Tidak ada jurnal atau Penerimaan Penjualan yang diposting ke Accurate.</small></section>';
}
function render(record,duplicate=false){
  const a=record.analysis||{},v=record.validation||{},rows=(a.transactions||[]).slice(0,300).map(row=>'<tr class="'+(row.needsReview||row.confidence<0.8?'warnrow':'')+'"><td>'+esc(row.date||'—')+'</td><td>'+esc(row.description||'—')+(row.issue?'<small>'+esc(row.issue)+'</small>':'')+'</td><td>'+rp(row.debit)+'</td><td>'+rp(row.credit)+'</td><td>'+(row.balance===null?'—':rp(row.balance))+'</td><td>'+Math.round((row.confidence||0)*100)+'%</td></tr>').join('');
  resultBox.hidden=false;resultBox.innerHTML='<div class="resulthead"><div><b>'+esc(record.statementId)+'</b><span>'+esc(a.bankName||'Bank belum terdeteksi')+' • Rek ****'+esc(a.accountLast4||'—')+'</span></div><span class="state">'+esc(record.status)+'</span></div>'+
    (duplicate?'<div class="uploadstatus info">File sama sudah pernah diunggah. Hasil lama ditampilkan tanpa biaya AI ulang.</div>':'')+
    (record.error?'<div class="uploadstatus bad">'+esc(record.error)+'</div>':'')+
    '<div class="summary"><div><small>Transaksi</small><b>'+esc(v.transactionCount||0)+'</b></div><div><small>Total Debit</small><b>'+rp(v.totalDebit)+'</b></div><div><small>Total Kredit</small><b>'+rp(v.totalCredit)+'</b></div><div><small>Cek Saldo</small><b>'+esc(v.balanceCheck||'—')+'</b></div><div><small>Perlu Review</small><b>'+esc(v.lowConfidenceCount||0)+'</b></div></div>'+
    ((v.issues||[]).length?'<ul class="issues">'+v.issues.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+
    (rows?'<div class="scrollhint">Geser tabel ke kiri/kanan untuk melihat semua kolom.</div><div class="tablewrap"><table class="statement-table"><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo</th><th>Keyakinan</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'')+
    reconciliationHtml(record)+
    (record.status==='REVIEW_REQUIRED'?'<div class="review"><input id="reviewNote" maxlength="1000" placeholder="Catatan akuntan (opsional)"><button type="button" id="confirmStatement">Konfirmasi hasil pembacaan</button><small>Konfirmasi hanya mengunci hasil baca rekening koran. Tidak membuat jurnal.</small></div>':'')+
    (record.status==='CONFIRMED'&&!record.reconciliation?'<div class="review"><button type="button" id="reconcileStatement">Cocokkan dengan Penjualan Lion Parcel</button><small>Rule engine membaca Faktur/Penerimaan Penjualan Accurate secara read-only.</small></div>':'');
  document.querySelector('#confirmStatement')?.addEventListener('click',()=>confirmRecord(record.statementId));
  document.querySelector('#reconcileStatement')?.addEventListener('click',()=>reconcileRecord(record.statementId));
  resultBox.scrollIntoView({behavior:'smooth',block:'start'});
}
async function postAction(body){const response=await fetch('/admin-ai-accurate-upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.message||'Proses gagal.');return data;}
async function confirmRecord(statementId){
  const button=document.querySelector('#confirmStatement');button.disabled=true;button.textContent='Menyimpan...';
  try{const data=await postAction({action:'confirm',statementId,note:document.querySelector('#reviewNote')?.value||''});render(data.record);setStatus('Hasil baca dikonfirmasi. Lanjutkan pencocokan Lion Parcel.','good');}
  catch(error){setStatus(error.message,'bad');button.disabled=false;button.textContent='Konfirmasi hasil pembacaan';}
}
async function reconcileRecord(statementId){
  const button=document.querySelector('#reconcileStatement');button.disabled=true;button.textContent='Membaca Accurate...';setStatus('Mencocokkan kredit bank dengan Faktur/Penerimaan Penjualan berdasarkan tanggal dan nominal.','info');
  try{const data=await postAction({action:'reconcile_lion_parcel',statementId});render(data.record);setStatus('Rekonsiliasi selesai. Periksa kandidat dan transaksi yang belum cocok.','good');}
  catch(error){setStatus(error.message,'bad');button.disabled=false;button.textContent='Cocokkan dengan Penjualan Lion Parcel';}
}
form.addEventListener('submit',async event=>{
  event.preventDefault();const selected=[...form.elements.files.files];if(!selected.length)return setStatus('Pilih PDF atau foto rekening koran.','bad');
  const button=form.querySelector('button[type=submit]');button.disabled=true;button.textContent='Membaca dokumen...';setStatus('Mengamankan file dan membaca seluruh transaksi. Jangan tutup halaman.','info');resultBox.hidden=true;
  try{
    const data=new FormData();let total=0;
    for(const file of selected){const normalized=await imageToJpeg(file);total+=normalized.size;data.append('files',normalized);}
    if(total>5*1024*1024)throw new Error('Total file masih lebih dari 5 MB. Kurangi jumlah foto atau gunakan PDF yang lebih kecil.');
    const response=await fetch('/admin-ai-accurate-upload',{method:'POST',body:data});const payload=await response.json();
    if(!response.ok||!payload.ok)throw new Error(payload.message||'Upload gagal.');
    render(payload.record,payload.duplicate);setStatus(payload.record.status==='EXTRACTION_FAILED'?'File aman tersimpan, tetapi pembacaan AI gagal. Lihat pesan di bawah.':'Draft berhasil dibuat. Periksa semua baris sebelum konfirmasi.','good');
  }catch(error){setStatus(error.message||'Upload gagal.','bad');}
  finally{button.disabled=false;button.textContent='Upload & Baca dengan AI';}
});
