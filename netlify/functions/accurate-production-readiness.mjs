import { getStore } from '@netlify/blobs';
import { accurateConfigStatus, resolveAccurateConnection, validateAccurateAccountMap } from './_accurate-core.mjs';
import { assertAdminPermission } from './_admin-rbac-core.mjs';
import { getAdminSession } from './_partner-core.mjs';

const STORE='libra-accurate-sync';
const store=()=>getStore(STORE);
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const dbName=db=>clean(db?.alias||db?.name||db?.databaseName||db?.companyName||'',160);
const isTest=name=>/(test|tes|uat|sandbox)/i.test(String(name||''));
const expectedProductionName=()=>clean(process.env.ACCURATE_PRODUCTION_DATABASE_NAME,160);

async function strongUatPass(){
 const {blobs}=await store().list({prefix:'job/'}),rows=[];
 for(const blob of blobs){
  const entry=await store().getWithMetadata(blob.key,{type:'json',consistency:'strong'}),row=entry?.data;
  if(row?.liveUat)rows.push(row);
 }
 const passed=rows.filter(r=>r.status==='POSTED'&&String(r.journalNumber||'').startsWith('LBR-UAT-ACC-')&&Number(r.journalDraft?.totalDebit)===10000&&Number(r.journalDraft?.totalCredit)===10000&&r.journalDraft?.balanced===true).sort((a,b)=>String(b.postedAt||'').localeCompare(String(a.postedAt||'')))[0]||null;
 return {passed:Boolean(passed),job:passed,totalUat:rows.length};
}

export default async request=>{
 const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);
 try{assertAdminPermission(session,'finance.reconcile');}catch{return new Response('Forbidden',{status:403});}
 if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const config=accurateConfigStatus(),expected=expectedProductionName();let connection=null,currentName='',connectionError='',validation={ok:false,mapped:[]};
 if(config.configured){
  try{connection=await resolveAccurateConnection();currentName=dbName(connection.database);validation=await validateAccurateAccountMap();}catch(e){connectionError=clean(e?.message||e,500);}
 }
 const uat=await strongUatPass(),currentIsTest=isTest(currentName),expectedSet=Boolean(expected),identityMatch=expectedSet&&Boolean(currentName)&&currentName.toLowerCase()===expected.toLowerCase();
 const productionDbVerified=Boolean(connection&&!currentIsTest&&identityMatch),gateLocked=!config.postingEnabled;
 const readyToArm=Boolean(uat.passed&&config.configured&&config.mappingReady&&validation.ok&&productionDbVerified&&gateLocked);
 const badge=(ok,yes='PASS',no='BELUM')=>`<b class="${ok?'ok':'bad'}">${ok?yes:no}</b>`;
 const mappingRows=(validation.mapped||[]).map(x=>`<tr><td>${esc(x.role)}</td><td>${esc(x.no)}</td><td>${x.found?'<b class="ok">FOUND</b>':'<b class="bad">MISSING</b>'}</td><td>${esc(x.name||'-')}</td></tr>`).join('');
 return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Accurate Production Readiness | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:1050px;margin:auto}.topin{display:flex;justify-content:space-between;gap:12px}.top a{color:#fff}.wrap{padding:22px 16px 50px}.hero,.card{border-radius:18px;padding:20px}.hero{background:${readyToArm?'#e7f6ed':'#fff6df'};border:1px solid ${readyToArm?'#b9dfc8':'#eed79a'}}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.stat,.card{background:#fff;border:1px solid #dce6ef}.stat{padding:14px;border-radius:14px}.stat small,.stat b{display:block}.card{margin-top:14px}.ok{color:#176b37}.bad{color:#a12e27}.warn{color:#8b6511}.big{font-size:24px}.tablewrap{overflow:auto}table{width:100%;min-width:650px;border-collapse:collapse;font-size:12px}th,td{padding:9px;border-bottom:1px solid #edf1f5;text-align:left}th{background:#f7fafc}code{word-break:break-all}.next{background:#eef5fb;border-left:5px solid #0b4d7a}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA • Accurate Production Readiness</strong><a href="/admin-accurate">← Accurate Bridge</a></div></header><main class="wrap"><section class="hero"><h1>${readyToArm?'READY TO ARM — belum go-live':'Production masih terkunci'}</h1><p>${readyToArm?'Semua precondition production sudah lolos. ACCURATE_POSTING_ENABLED tetap false sampai Owner memutuskan go-live.':'UAT sudah menjadi dasar verifikasi, tetapi production tidak akan dibuka sebelum database actual dan COA actual terverifikasi.'}</p></section>${connectionError?`<section class="card"><b class="bad">Connection error:</b> ${esc(connectionError)}</section>`:''}<section class="grid"><div class="stat"><small>Live UAT Rp10.000</small>${badge(uat.passed,'PASSED','BELUM')}<small>${uat.job?`${esc(uat.job.journalNumber)} • ${esc(uat.job.postedAt||'')}`:'Belum ada UAT POSTED'}</small></div><div class="stat"><small>Production Posting Gate</small>${badge(gateLocked,'TERKUNCI','AKTIF')}<small>Harus TERKUNCI selama readiness</small></div><div class="stat"><small>COA Live</small>${badge(validation.ok,'VALID','BELUM VALID')}<small>${(validation.mapped||[]).filter(x=>x.found).length}/${(validation.mapped||[]).length} mapping ditemukan</small></div><div class="stat"><small>Database Terhubung</small><b class="${currentIsTest?'warn':currentName?'ok':'bad'}">${esc(currentName||'TIDAK TERDETEKSI')}</b><small>${currentIsTest?'Masih database TEST':'Bukan nama database test'}</small></div><div class="stat"><small>Expected Production DB</small><b class="${expectedSet?'ok':'bad'}">${esc(expected||'BELUM DISET')}</b><small>Env: ACCURATE_PRODUCTION_DATABASE_NAME</small></div><div class="stat"><small>Identity Lock</small>${badge(productionDbVerified,'MATCH','BELUM MATCH')}<small>Harus exact match dengan database actual</small></div></section><section class="card"><h2>COA Production Check</h2><div class="tablewrap"><table><thead><tr><th>Role</th><th>No Akun</th><th>Status</th><th>Nama Akun</th></tr></thead><tbody>${mappingRows||'<tr><td colspan="4">Belum dapat membaca COA.</td></tr>'}</tbody></table></div></section><section class="card next"><h2>Urutan pindah ke Production</h2><p>1. Import COA final ke database Accurate actual. 2. Install aplikasi Libra Super Admin ke database actual. 3. Buat API Token khusus database actual lalu ganti credential Netlify tanpa menampilkan token di chat. 4. Set <code>ACCURATE_PRODUCTION_DATABASE_NAME</code> persis sama dengan nama database actual. 5. Buka halaman ini lagi dan pastikan Database bukan Test, COA VALID, Identity Lock MATCH, UAT PASSED, dan Production Gate masih TERKUNCI. 6. Baru setelah semua PASS, Owner dapat memutuskan mengaktifkan production posting.</p><p><b>Tidak ada aksi write production di halaman ini.</b></p></section></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-accurate/readiness'};
