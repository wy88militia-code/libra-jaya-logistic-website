import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { accurateConfigStatus, resolveAccurateConnection, validateAccurateAccountMap } from './_accurate-core.mjs';
import { assertAdminPermission } from './_admin-rbac-core.mjs';
import { getAdminSession } from './_partner-core.mjs';

const STORE='libra-accurate-sync';
const store=()=>getStore(STORE);
const now=()=>new Date().toISOString();
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const explicitTestMode=()=>String(process.env.ACCURATE_TEST_MODE||'').trim().toLowerCase()==='true';
const isTestDatabaseName=name=>/(test|tes|uat|sandbox)/i.test(String(name||''));
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
function sameOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).origin===new URL(request.url).origin;}catch{return false;}}
function currentWitTestDate(){const d=new Date(Date.now()+9*3600000),y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0'),day=String(d.getUTCDate()).padStart(2,'0');return {period:`${y}-${m}`,jobPeriod:`UAT-${y}-${m}`,compact:`${y}${m}${day}`,iso:`${y}-${m}-${day}T00:00:00+09:00`,display:`${day}/${m}/${y}`};}
function databaseName(database){return clean(database?.alias||database?.name||database?.databaseName||database?.companyName||'',160);}

async function createLiveTestJob(actor){
 const config=accurateConfigStatus();
 if(!config.configured)throw new Error('Koneksi Accurate belum dikonfigurasi.');
 if(!config.mappingReady)throw new Error('Account mapping belum lengkap.');
 if(config.postingEnabled)throw new Error('Kunci ACCURATE_POSTING_ENABLED=false sebelum membuat live-test job.');
 const connection=await resolveAccurateConnection();
 const dbName=databaseName(connection.database);
 const dbIsTest=isTestDatabaseName(dbName);
 if(dbName&&!dbIsTest)throw new Error(`Database "${dbName}" tidak terdeteksi sebagai database test. Live test diblokir.`);
 if(!dbName&&!explicitTestMode())throw new Error('Nama database tidak dikembalikan Accurate dan ACCURATE_TEST_MODE belum true. Live test diblokir.');
 const validation=await validateAccurateAccountMap();
 if(!validation.ok)throw new Error('Live Chart of Accounts validation belum lolos.');
 const testDate=currentWitTestDate(),amount=10000,statementNo=`LBR-UAT-ACC-${testDate.compact}`;
 const base={statementNo,transactionDate:testDate.iso,amount,customerDeposit:config.accountMap.customerDeposit,serviceRevenue:config.accountMap.serviceRevenue};
 const statementHash=crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex');
 const jobId=`ACC-UAT-${statementHash.slice(0,20).toUpperCase()}`;
 const createdAt=now();
 const journalDraft={documentType:'JOURNAL_VOUCHER',source:'LIBRA_ACCURATE_LIVE_UAT',statementNo,partnerId:'UAT-ACCURATE',period:testDate.jobPeriod,transactionDate:testDate.iso,description:`UAT Accurate API ${testDate.display} - TEST DATABASE ONLY`,entries:[{role:'CUSTOMER_DEPOSIT',accountNo:config.accountMap.customerDeposit,debit:amount,credit:0,memo:'UAT settlement deposit - TEST ONLY'},{role:'SERVICE_REVENUE',accountNo:config.accountMap.serviceRevenue,debit:0,credit:amount,memo:'UAT pendapatan jasa - TEST ONLY'}],totalDebit:amount,totalCredit:amount,balanced:true,mappingReady:true};
 const row={jobId,status:'READY_FOR_REVIEW',partnerId:'UAT-ACCURATE',month:testDate.jobPeriod,uatAccountingPeriod:testDate.period,uatTransactionDate:testDate.iso,statementNo,statementHash,journalNumber:statementNo,journalDraft,createdAt,createdBy:clean(actor,100),updatedAt:createdAt,lastError:null,postedAt:null,accurateReference:null,accurateId:null,approvalRequestId:null,duplicate:false,liveUat:true};
 const key=`job/${statementHash}`;
 const result=await store().setJSON(key,row,{onlyIfNew:true});
 if(result.modified)return {job:row,duplicate:false,databaseName:dbName||'nama database tidak dikembalikan API',host:connection.host,validation,testDate};
 const existing=await store().get(key,{type:'json',consistency:'strong'});
 if(existing)return {job:{...existing,duplicate:true},duplicate:true,databaseName:dbName||'nama database tidak dikembalikan API',host:connection.host,validation,testDate};
 throw new Error('Live-test job sedang diproses. Coba kembali.');
}

export default async request=>{
 const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);try{assertAdminPermission(session,'finance.reconcile');}catch{return new Response('Forbidden',{status:403});}
 let message='',error='',result=null;
 if(request.method==='POST'){
  if(!sameOrigin(request))return new Response('Forbidden',{status:403});
  try{result=await createLiveTestJob(session.username);message=result.duplicate?`Live-test job ${result.job.jobId} sudah ada; tidak dibuat duplikat.`:`Live-test job ${result.job.jobId} dibuat untuk tanggal ${result.testDate.display}. Belum ada write ke Accurate.`;}catch(e){error=e?.message||'Gagal membuat Accurate live-test job.';}
 }else if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const config=accurateConfigStatus();
 let detectedDbName='',dbIsTest=false;
 if(config.configured){try{const connection=await resolveAccurateConnection();detectedDbName=databaseName(connection.database);dbIsTest=isTestDatabaseName(detectedDbName);}catch{}}
 const tm=dbIsTest||(!detectedDbName&&explicitTestMode()),today=currentWitTestDate();
 return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Accurate Live Test | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:900px;margin:auto}.topin{display:flex;justify-content:space-between}.top a{color:#fff}.wrap{padding:24px 16px 50px}.hero,.card{border-radius:18px;padding:20px}.hero{background:#eaf4fb}.card{background:#fff;border:1px solid #dce6ef;margin-top:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stat{background:#f7fafc;padding:12px;border-radius:12px}.stat small,.stat b{display:block}.ok{color:#176b37}.bad{color:#9d2822}.notice{padding:12px;border-radius:10px;margin:12px 0}.success{background:#e8f6ee;color:#176b37}.error{background:#fff0ef;color:#9e2621}button{border:0;border-radius:9px;background:#0b2d52;color:#fff;padding:11px 15px;font-weight:800;font:inherit}button:disabled{opacity:.45}code{word-break:break-all}@media(max-width:650px){.grid{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA • Accurate Live Test</strong><a href="/admin-accurate">← Accurate Bridge</a></div></header><main class="wrap"><section class="hero"><h1>Live Test Rp10.000 — Database Test</h1><p>UAT memakai <b>tanggal berjalan WIT (${today.display})</b>, bukan bulan sebelumnya, agar tidak membuat jurnal sebelum tanggal awal database test. Halaman ini hanya membuat job queue; belum ada direct post.</p></section>${message?`<div class="notice success">${esc(message)}</div>`:''}${error?`<div class="notice error">${esc(error)}</div>`:''}<section class="card"><div class="grid"><div class="stat"><small>Test Database Guard</small><b class="${tm?'ok':'bad'}">${tm?'ACTIVE':'INACTIVE'}</b><small>${detectedDbName?`Database: ${esc(detectedDbName)}`:'Nama database tidak dikembalikan API'}</small></div><div class="stat"><small>Production Posting Gate</small><b class="${config.postingEnabled?'bad':'ok'}">${config.postingEnabled?'AKTIF':'TERKUNCI'}</b></div><div class="stat"><small>UAT Transaction Date</small><b>${today.display}</b></div><div class="stat"><small>Mapping</small><b>${config.mappingReady?'READY':'BELUM LENGKAP'}</b></div></div></section><section class="card"><h2>Step 1 — Buat Job UAT Baru</h2><p>Job UAT lama periode Agustus jangan diposting. Buat job baru dengan tanggal berjalan di database <b>${esc(detectedDbName||'test')}</b>.</p><form method="post"><button ${!tm||config.postingEnabled||!config.configured||!config.mappingReady?'disabled':''}>Buat Live-Test Job Rp10.000</button></form>${result?`<p><b>Job:</b> <code>${esc(result.job.jobId)}</code><br><b>JV:</b> <code>${esc(result.job.journalNumber)}</code><br><b>Tanggal:</b> ${esc(result.testDate.display)}<br><b>Database:</b> ${esc(result.databaseName)}<br><b>Host:</b> ${esc(result.host)}<br><b>Status:</b> ${esc(result.job.status)}<br><b>Debit/Credit:</b> Rp10.000 / Rp10.000</p>`:''}</section><section class="card"><h2>Sesudah Job Dibuat</h2><p>Kembali ke <a href="/admin-accurate">Accurate Bridge</a>, cek job baru dan Export JSON. <b>ACCURATE_POSTING_ENABLED tetap false</b> sampai job baru diverifikasi.</p></section></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-accurate/live-test'};
