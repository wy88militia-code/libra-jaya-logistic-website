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
function render(record,duplicate=false){
  const a=record.analysis||{},v=record.validation||{},rows=(a.transactions||[]).slice(0,300).map(row=>'<tr class="'+(row.needsReview||row.confidence<0.8?'warnrow':'')+'"><td>'+esc(row.date||'—')+'</td><td>'+esc(row.description||'—')+(row.issue?'<small>'+esc(row.issue)+'</small>':'')+'</td><td>'+rp(row.debit)+'</td><td>'+rp(row.credit)+'</td><td>'+(row.balance===null?'—':rp(row.balance))+'</td><td>'+Math.round((row.confidence||0)*100)+'%</td></tr>').join('');
  resultBox.hidden=false;resultBox.innerHTML='<div class="resulthead"><div><b>'+esc(record.statementId)+'</b><span>'+esc(a.bankName||'Bank belum terdeteksi')+' • Rek ****'+esc(a.accountLast4||'—')+'</span></div><span class="state">'+esc(record.status)+'</span></div>'+
    (duplicate?'<div class="uploadstatus info">File sama sudah pernah diunggah. Hasil lama ditampilkan tanpa biaya AI ulang.</div>':'')+
    (record.error?'<div class="uploadstatus bad">'+esc(record.error)+'</div>':'')+
    '<div class="summary"><div><small>Transaksi</small><b>'+esc(v.transactionCount||0)+'</b></div><div><small>Total Debit</small><b>'+rp(v.totalDebit)+'</b></div><div><small>Total Kredit</small><b>'+rp(v.totalCredit)+'</b></div><div><small>Cek Saldo</small><b>'+esc(v.balanceCheck||'—')+'</b></div><div><small>Perlu Review</small><b>'+esc(v.lowConfidenceCount||0)+'</b></div></div>'+
    ((v.issues||[]).length?'<ul class="issues">'+v.issues.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+
    (rows?'<div class="tablewrap"><table><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo</th><th>Keyakinan</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'')+
    (record.status==='REVIEW_REQUIRED'?'<div class="review"><input id="reviewNote" maxlength="1000" placeholder="Catatan akuntan (opsional)"><button type="button" id="confirmStatement">Konfirmasi hasil pemeriksaan</button><small>Konfirmasi ini hanya mengunci hasil review. Tidak membuat jurnal dan tidak mengirim transaksi ke Accurate.</small></div>':'');
  document.querySelector('#confirmStatement')?.addEventListener('click',()=>confirmRecord(record.statementId));
  resultBox.scrollIntoView({behavior:'smooth',block:'start'});
}
async function confirmRecord(statementId){
  const button=document.querySelector('#confirmStatement');button.disabled=true;button.textContent='Menyimpan...';
  try{const response=await fetch('/admin-ai-accurate-upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'confirm',statementId,note:document.querySelector('#reviewNote')?.value||''})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.message||'Konfirmasi gagal.');render(data.record);setStatus('Hasil sudah dikonfirmasi akuntan. Tidak ada posting ke Accurate.','good');}
  catch(error){setStatus(error.message,'bad');button.disabled=false;button.textContent='Konfirmasi hasil pemeriksaan';}
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
