import { accurateGet, resolveAccurateConnection } from './_accurate-core.mjs';
import { assertAdminPermission } from './_admin-rbac-core.mjs';
import { getAdminSession } from './_partner-core.mjs';

const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const databaseName=db=>clean(db?.alias||db?.name||db?.databaseName||db?.companyName||'',160);
const targetBranch=()=>clean(process.env.ACCURATE_BRANCH_JLX||'JLX Cargo',160);

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
 const found=rows.find(r=>String(r?.name||'').trim().toLowerCase()===target.toLowerCase())||null;
 const similar=rows.filter(r=>String(r?.name||'').toLowerCase().includes('jlx')||String(r?.name||'').toLowerCase().includes('cargo')).slice(0,20);
 const similarRows=similar.map(r=>`<tr><td>${esc(r.id??'-')}</td><td>${esc(r.name||'-')}</td><td>${found&&String(found.id)===String(r.id)?'<b class="ok">TARGET</b>':'—'}</td></tr>`).join('');
 return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Accurate Branch Check | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:900px;margin:auto}.topin{display:flex;justify-content:space-between;gap:12px}.top a{color:#fff}.wrap{padding:22px 16px 50px}.hero,.card{border-radius:18px;padding:20px}.hero{background:${found?'#e7f6ed':'#fff6df'};border:1px solid ${found?'#b9dfc8':'#eed79a'}}.card{background:#fff;border:1px solid #dce6ef;margin-top:14px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.stat{background:#fff;border:1px solid #dce6ef;border-radius:14px;padding:14px}.stat small,.stat b{display:block}.ok{color:#176b37}.bad{color:#a12e27}.warn{color:#8b6511}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px;border-bottom:1px solid #edf1f5;text-align:left}th{background:#f7fafc}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA • Accurate Branch Check</strong><a href="/admin-accurate">← Accurate Bridge</a></div></header><main class="wrap"><section class="hero"><h1>${found?'Cabang JLX Cargo ditemukan':'Cabang target belum ditemukan'}</h1><p>Read-only check. Halaman ini tidak membuat atau mengubah transaksi Accurate.</p></section>${error?`<section class="card"><b class="bad">Error:</b> ${esc(error)}</section>`:''}<section class="grid"><div class="stat"><small>Database terhubung</small><b>${esc(db||'-')}</b></div><div class="stat"><small>Target Cabang</small><b>${esc(target)}</b></div><div class="stat"><small>Status</small><b class="${found?'ok':'bad'}">${found?'FOUND':'MISSING'}</b>${found?`<small>ID ${esc(found.id)}</small>`:''}</div></section><section class="card"><h2>Cabang yang relevan</h2><div class="tablewrap"><table><thead><tr><th>ID</th><th>Nama Cabang</th><th>Status</th></tr></thead><tbody>${similarRows||'<tr><td colspan="3">Tidak ada nama JLX/Cargo yang terbaca.</td></tr>'}</tbody></table></div><p><small>Total cabang terbaca: ${rows.length}. Target default adalah <b>JLX Cargo</b>; dapat dioverride melalui env ACCURATE_BRANCH_JLX bila nama berubah.</small></p></section><section class="card"><h2>Langkah berikutnya</h2><p>${found?'FOUND berarti API Accurate dapat membaca cabang JLX Cargo. Tahap berikutnya adalah UAT Journal Voucher khusus cabang dengan header branchName=JLX Cargo sebelum mapping production dipakai.':'Periksa nama cabang di Accurate atau scope branch_view pada API Token. Jangan lakukan UAT cabang sampai status FOUND.'}</p></section></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-accurate/branch-check'};
