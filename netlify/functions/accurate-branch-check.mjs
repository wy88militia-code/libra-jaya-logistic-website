import { accurateGet, resolveAccurateConnection } from './_accurate-core.mjs';
import { assertAdminPermission } from './_admin-rbac-core.mjs';
import { getAdminSession } from './_partner-core.mjs';

const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const databaseName=db=>clean(db?.alias||db?.name||db?.databaseName||db?.companyName||'',160);
const targetBranch=()=>clean(process.env.ACCURATE_BRANCH_JLX||'JLX Cargo',160);
const isTest=name=>/(test|tes|uat|sandbox)/i.test(String(name||''));

async function listBranches(){
 const rows=[];let page=1,pageCount=1;
 do{
  const {data}=await accurateGet('branch','list',{'sp.pageSize':100,'sp.page':page,'fields':'id,name'});
  const batch=Array.isArray(data?.d)?data.d:[];rows.push(...batch);
  pageCount=Math.max(1,Math.min(Number(data?.sp?.pageCount)||1,100));page+=1;
 }while(page<=pageCount);
 return rows;
}

export default async request=>{
 const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);
 try{assertAdminPermission(session,'finance.reconcile');}catch{return new Response('Forbidden',{status:403});}
 if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 let db='',rows=[],error='';const target=targetBranch();
 try{const connection=await resolveAccurateConnection();db=databaseName(connection.database);rows=await listBranches();}catch(e){error=clean(e?.message||e,600);}
 const testDb=isTest(db),norm=v=>String(v||'').trim().toLowerCase();
 const found=rows.find(r=>norm(r?.name)===norm(target))||null;
 const allRows=rows.map(r=>`<tr><td>${esc(r.id??'-')}</td><td><b>${esc(r.name||'(nama kosong)')}</b></td><td>${found&&String(found.id)===String(r.id)?'<b class="ok">TARGET / FOUND</b>':'<span class="warn">Bukan target</span>'}</td></tr>`).join('');
 const detected=rows.length===1?clean(rows[0]?.name||'',160):'';
 const statusLabel=testDb?'N/A — TEST DB':found?'FOUND':'MISSING';
 const statusClass=testDb?'warn':found?'ok':'bad';
 const diagnosis=testDb
  ?`Database <b>${esc(db)}</b> adalah database test. Karena cabang production <b>${esc(target)}</b> dibuat di database actual dan database test tidak mendukung penambahan cabang yang sama, status cabang di sini tidak menjadi syarat UAT API. Cabang akan divalidasi read-only setelah koneksi dipindah ke database actual.`
  :found
   ?`API Accurate membaca cabang <b>${esc(target)}</b> secara exact. Mapping cabang production siap.`
   :rows.length===0
    ?'API tidak mengembalikan cabang. Periksa akses/scope branch_view pada API Token.'
    :`API berhasil membaca ${rows.length} cabang, tetapi tidak ada yang bernama exact <b>${esc(target)}</b>.${detected?` Nama yang terbaca sekarang adalah <b>${esc(detected)}</b>.`:''} Pastikan cabang dibuat pada database actual yang sedang terhubung.`;
 return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Accurate Branch Check | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:900px;margin:auto}.topin{display:flex;justify-content:space-between;gap:12px}.top a{color:#fff}.wrap{padding:22px 16px 50px}.hero,.card{border-radius:18px;padding:20px}.hero{background:${found&&!testDb?'#e7f6ed':'#fff6df'};border:1px solid ${found&&!testDb?'#b9dfc8':'#eed79a'}}.card{background:#fff;border:1px solid #dce6ef;margin-top:14px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.stat{background:#fff;border:1px solid #dce6ef;border-radius:14px;padding:14px}.stat small,.stat b{display:block}.ok{color:#176b37}.bad{color:#a12e27}.warn{color:#8b6511}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px;border-bottom:1px solid #edf1f5;text-align:left}th{background:#f7fafc}.diag{border-left:5px solid #d49b2d;background:#fff9ea}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA • Accurate Branch Check</strong><a href="/admin-accurate">← Accurate Bridge</a></div></header><main class="wrap"><section class="hero"><h1>${testDb?'Cabang production divalidasi di database actual':found?'Cabang JLX Cargo ditemukan':'Cabang target belum ditemukan'}</h1><p>Read-only check. Halaman ini tidak membuat atau mengubah transaksi Accurate.</p></section>${error?`<section class="card"><b class="bad">Error:</b> ${esc(error)}</section>`:''}<section class="grid"><div class="stat"><small>Database terhubung</small><b>${esc(db||'-')}</b></div><div class="stat"><small>Target Cabang</small><b>${esc(target)}</b></div><div class="stat"><small>Status</small><b class="${statusClass}">${statusLabel}</b>${found&&!testDb?`<small>ID ${esc(found.id)}</small>`:''}</div></section><section class="card diag"><h2>Diagnosis</h2><p>${diagnosis}</p></section><section class="card"><h2>Semua cabang yang dibaca API</h2><div class="tablewrap"><table><thead><tr><th>ID</th><th>Nama Cabang di Accurate API</th><th>Status</th></tr></thead><tbody>${allRows||'<tr><td colspan="3">Tidak ada cabang yang terbaca.</td></tr>'}</tbody></table></div><p><small>Total cabang terbaca: ${rows.length}. Target production sistem adalah <b>${esc(target)}</b>.</small></p></section><section class="card"><h2>Langkah berikutnya</h2><p>${testDb?'Tidak perlu membuat JLX Cargo di database test. Bukti UAT Rp10.000 yang sudah POSTED tetap dipakai sebagai bukti jalur API/Journal Voucher. Nanti setelah token dipindah ke database actual, buka halaman ini lagi dan status wajib berubah menjadi FOUND sebelum production dapat diaktifkan.':found?'Status FOUND. Cabang production siap menjadi salah satu gate go-live.':'Cabang production belum cocok. Perbaiki nama cabang di database actual menjadi persis JLX Cargo atau set ACCURATE_BRANCH_JLX sesuai nama exact sebelum go-live.'}</p></section></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-accurate/branch-check'};
