import { accurateConfigStatus, accurateGet, testAccurateConnection } from './_accurate-core.mjs';
import { canRoleAccessPath } from './_admin-rbac-core.mjs';
import { getAdminSession } from './_partner-core.mjs';

const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const clean=(value,max=180)=>String(value??'').trim().slice(0,max);
const rp=value=>Number.isFinite(Number(value))?`Rp${Math.trunc(Number(value)).toLocaleString('id-ID')}`:'—';
function dbName(database){return clean(database?.alias||database?.name||database?.databaseName||database?.companyName||'',160)||'Database Accurate terotorisasi';}
async function probe(resource,fields,sort=''){
  try{
    const params={'sp.pageSize':5,'sp.page':1,fields};
    if(sort)params['sp.sort']=sort;
    const {data}=await accurateGet(resource,'list',params);
    const rows=Array.isArray(data?.d)?data.d:[];
    return {ok:true,rows,pageCount:Number(data?.sp?.pageCount)||null,rowCount:Number(data?.sp?.rowCount||data?.sp?.totalRows||data?.sp?.total)||null,error:null};
  }catch(error){return {ok:false,rows:[],pageCount:null,rowCount:null,error:clean(error?.message||error,300)};}
}
async function liveSnapshot(){
  const config=accurateConfigStatus();
  if(!config.configured)return {ok:false,config,error:'Credential Accurate belum dikonfigurasi.',connection:null,coa:null,customers:null,invoices:null};
  try{
    const connection=await testAccurateConnection();
    const [coa,customers,invoices]=await Promise.all([
      probe('glaccount','id,no,name,accountType'),
      probe('customer','id,no,name,suspended'),
      probe('sales-invoice','id,number,transDate,totalAmount','transDate|desc')
    ]);
    return {ok:Boolean(connection?.ok&&coa.ok&&customers.ok&&invoices.ok),config,connection,coa,customers,invoices,error:null};
  }catch(error){return {ok:false,config,error:clean(error?.message||error,500),connection:null,coa:null,customers:null,invoices:null};}
}
function statusCard(label,ok,detail){
  return `<div class="stat"><small>${esc(label)}</small><b class="${ok?'ok':'bad'}">${ok?'PASS':'FAIL'}</b><span>${esc(detail||'—')}</span></div>`;
}
function render({session,live}){
  const modules=[
    ['01','Koneksi Accurate Online','Menggunakan adapter produksi yang sudah ada dengan operasi GET saja.',live.connection?.ok?'TERHUBUNG':'PERLU CEK'],
    ['02','Sinkronisasi Master','COA dan pelanggan sudah dapat dibaca. Pemasok, pegawai, cabang dan pajak menyusul.','BERJALAN'],
    ['03','Impor Rekening Koran','Excel/CSV, normalisasi dan duplicate guard.','BELUM DIMULAI'],
    ['04','Rule-based Matching','Nominal, tanggal, referensi, invoice dan lawan transaksi.','BELUM DIMULAI'],
    ['05','AI Exception Review','AI hanya menganalisis transaksi yang tidak cocok atau konflik.','BELUM DIMULAI'],
    ['06','Klarifikasi & Review','Akuntan menyetujui, mengubah, menolak atau meminta bukti.','BELUM DIMULAI'],
    ['07','Kertas Kerja Koreksi','Draft reklasifikasi tanpa posting otomatis ke Accurate.','BELUM DIMULAI'],
    ['08','Laporan Bulanan','Rekonsiliasi bank, exception dan ringkasan Direksi.','BELUM DIMULAI']
  ];
  const cards=modules.map(([no,title,desc,status])=>`<article><div class="num">${no}</div><div><h2>${esc(title)}</h2><p>${esc(desc)}</p><span class="${status==='TERHUBUNG'?'done':''}">${esc(status)}</span></div></article>`).join('');
  const invoiceRows=(live.invoices?.rows||[]).map(row=>`<tr><td><b>${esc(row.number||row.id||'—')}</b></td><td>${esc(row.transDate||'—')}</td><td>${rp(row.totalAmount)}</td></tr>`).join('');
  const database=live.connection?dbName(live.connection.database):'—';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>AI Accurate Tahap 1 | Libra</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#10243d;font-family:Inter,system-ui,-apple-system,sans-serif}.top{background:#061d36;color:#fff;padding:20px}.topin,.wrap{max-width:1120px;margin:auto}.topin{display:flex;justify-content:space-between;align-items:center;gap:16px}.top strong{font-size:20px}.top span{display:block;color:#b9cce0;font-size:12px;margin-top:4px}.top a{color:#fff;text-decoration:none;border:1px solid #54718c;border-radius:9px;padding:9px 13px}.wrap{padding:28px 18px 54px}.hero{background:linear-gradient(135deg,#07345c,#12639a);color:#fff;border-radius:22px;padding:28px;display:grid;grid-template-columns:1fr auto;gap:20px;align-items:start}.hero h1{font-size:32px;margin:8px 0}.hero p{color:#dcebf7;line-height:1.55;max-width:720px}.pill{background:#e8f3ff;color:#075182;border:1px solid #b9d8ef;border-radius:999px;padding:8px 12px;font-size:11px;font-weight:900;display:inline-block}.lock{background:#ffffff17;border:1px solid #ffffff3b;border-radius:15px;padding:16px;min-width:230px}.lock b,.lock small{display:block}.lock small{color:#dcebf7;margin-top:6px}.notice{margin:16px 0;border-radius:14px;padding:15px;line-height:1.5}.success{background:#e8f6ee;border:1px solid #b9ddc8;color:#176b37}.error{background:#fff0ef;border:1px solid #ecc8c5;color:#9e2621}.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:16px 0}.stat{background:#fff;border:1px solid #dce6ef;border-radius:14px;padding:14px}.stat small,.stat b,.stat span{display:block}.stat small{color:#667b8e;font-weight:700}.stat b{font-size:18px;margin:5px 0}.stat span{font-size:11px;color:#65788a}.ok{color:#176b37}.bad{color:#a12e27}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.grid article{display:flex;gap:14px;background:#fff;border:1px solid #dce6ef;border-radius:16px;padding:18px}.num{width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;background:#e8f3ff;color:#075182;font-weight:900;border-radius:12px}.grid h2{font-size:17px;margin:0 0 7px}.grid p{font-size:13px;color:#5b6e82;line-height:1.5;margin:0 0 12px}.grid span{font-size:10px;font-weight:900;color:#85600b;background:#fff4cf;border-radius:999px;padding:6px 8px}.grid span.done{background:#e8f6ee;color:#176b37}.card{margin-top:18px;background:#fff;border:1px solid #dce6ef;border-radius:18px;padding:20px}.card h2{margin:0 0 12px}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px;border-bottom:1px solid #edf1f5;text-align:left}th{background:#f7fafc}.foot{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}.foot a{text-decoration:none;background:#0b2d52;color:#fff;border-radius:10px;padding:11px 14px;font-weight:800}.foot a.secondary{background:#e8f3ff;color:#075182}@media(max-width:850px){.stats{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.hero{grid-template-columns:1fr}.grid,.stats{grid-template-columns:1fr}.topin{align-items:flex-start}.top a{white-space:nowrap}}
  </style></head><body><header class="top"><div class="topin"><div><strong>LIBRA JAYA LOGISTIC</strong><span>AI Accurate • Tahap 1 • Internal</span></div><a href="/libra-admin">← Home Admin</a></div></header><main class="wrap"><section class="hero"><div><span class="pill">MASTER TAHAP 1 TERKUNCI</span><h1>AI Agent Accurate Libra</h1><p>Ruang kerja internal untuk review transaksi, rekonsiliasi bank, klasifikasi akun, klarifikasi dan laporan pemeriksaan bulanan.</p></div><div class="lock"><b>🔒 AGENT READ-ONLY</b><small>Modul ini hanya mengimpor fungsi baca. Tidak tersedia fungsi membuat, mengubah, menghapus atau posting ke Accurate.</small></div></section>${live.ok?`<div class="notice success"><b>Koneksi Accurate aktif.</b> Agent berhasil membaca database <b>${esc(database)}</b> melalui adapter ${esc(live.connection?.mode||live.config?.authMode||'')}. Diperiksa ${esc(live.connection?.testedAt||'')}.</div>`:`<div class="notice error"><b>Koneksi belum lolos.</b> ${esc(live.error||'Salah satu probe baca gagal. Periksa konfigurasi Accurate.')}</div>`}<section class="stats">${statusCard('Koneksi API',Boolean(live.connection?.ok),live.connection?.mode||live.config?.authMode)}${statusCard('Database',Boolean(live.connection?.ok),database)}${statusCard('Chart of Accounts',Boolean(live.coa?.ok),live.coa?.ok?'GET glaccount berhasil':live.coa?.error)}${statusCard('Pelanggan',Boolean(live.customers?.ok),live.customers?.ok?'GET customer berhasil':live.customers?.error)}${statusCard('Faktur Penjualan',Boolean(live.invoices?.ok),live.invoices?.ok?'GET sales-invoice berhasil':live.invoices?.error)}</section><section class="grid">${cards}</section><section class="card"><h2>Probe faktur penjualan terbaru</h2><p>Data ini hanya membuktikan jalur baca ke Accurate. Belum menjadi hasil rekonsiliasi atau analisis AI.</p><div class="tablewrap"><table><thead><tr><th>Nomor</th><th>Tanggal</th><th>Nilai</th></tr></thead><tbody>${invoiceRows||'<tr><td colspan="3">Tidak ada data yang dapat ditampilkan.</td></tr>'}</tbody></table></div></section><div class="foot"><a href="/admin-ai-accurate">Tes Ulang Koneksi</a><a class="secondary" href="https://docs.google.com/spreadsheets/d/1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k/edit#gid=2100000001" target="_blank" rel="noopener">Buka Master Tahap 1 ↗</a><a class="secondary" href="/admin-accurate">Bridge Accurate Existing</a></div></main></body></html>`;
}
export default async request=>{
  if(request.method!=='GET')return new Response('Method not allowed',{status:405});
  const session=getAdminSession(request);
  if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);
  if(!canRoleAccessPath(session.role,'/admin-ai-accurate'))return new Response('Akses hanya untuk SUPERADMIN atau FINANCE.',{status:403});
  const live=await liveSnapshot();
  return new Response(render({session,live}),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store, max-age=0','x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-ai-accurate'};
