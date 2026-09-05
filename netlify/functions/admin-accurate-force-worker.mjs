import { runAccurateAutoSync } from './_accurate-auto-core.mjs';
import { writeAdminAudit } from './_admin-audit-core.mjs';
import { getAdminSession } from './_partner-core.mjs';
import { markSystemHeartbeat } from './_system-heartbeat-core.mjs';

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
function sameOrigin(request){const u=new URL(request.url),origin=request.headers.get('origin'),ref=request.headers.get('referer');if(origin)return origin===u.origin;if(ref){try{return new URL(ref).origin===u.origin;}catch{return false;}}return true;}

async function runOnce(session,request){
  const result=await runAccurateAutoSync({limit:60});
  const counts=result?.counts||{};
  const bad=(counts.RECONCILE_REQUIRED||0)+(counts.POST_FAILED||0)+(counts.EXCEPTION||0)+(counts.RETRY||0);
  const heartbeatStatus=result?.ok===false||bad>0?'ERROR':'OK';
  const message=result?.skipped
    ?`Accurate Auto skipped: ${clean(result.reason||'unknown',360)}`
    :`FORCE RUN • Processed ${result?.processed||0} • Posted ${counts.POSTED||0} • Reconcile ${counts.RECONCILE_REQUIRED||0} • Failed ${counts.POST_FAILED||0} • Exception ${counts.EXCEPTION||0} • Retry ${counts.RETRY||0}`;
  await markSystemHeartbeat('ACCURATE_AUTO',{status:heartbeatStatus,message,metadata:{processed:result?.processed||0,counts,skipped:Boolean(result?.skipped),bad,trigger:'SUPERADMIN_FORCE'}}).catch(()=>{});
  await writeAdminAudit({session,request,action:'ACCURATE_AUTO_FORCE_RUN',entityType:'ACCURATE_WORKER',entityId:'ACCURATE_AUTO',before:null,after:{ok:Boolean(result?.ok),skipped:Boolean(result?.skipped),reason:clean(result?.reason,300)||null,processed:Number(result?.processed||0),counts},note:'SUPERADMIN menjalankan satu siklus Accurate Auto Worker secara manual. Production gate dan duplicate/read-back guard tetap aktif.'}).catch(()=>{});
  return result;
}

function render(result=null,error=''){
  const counts=result?.counts||{};
  const status=error?'ERROR':!result?'SIAP':result?.ok===false?'ERROR':result?.skipped?'SKIPPED':(counts.RECONCILE_REQUIRED||counts.POST_FAILED||counts.EXCEPTION||counts.RETRY)?'PERLU CEK':'OK';
  const cls=status==='OK'?'ok':status==='SIAP'?'warn':'bad';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Force Accurate Worker | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:760px;margin:auto}.topin{display:flex;justify-content:space-between;gap:12px}.top a{color:#fff}.wrap{padding:22px 16px}.card{background:#fff;border:1px solid #dce6ef;border-radius:18px;padding:20px;margin-bottom:14px}.ok{color:#176b37}.warn{color:#8b6511}.bad{color:#a12e27}.btn{border:0;border-radius:12px;background:#0b4d7a;color:#fff;padding:14px 18px;font-weight:850;font-size:16px}.note{background:#eef5fb;border-left:5px solid #0b4d7a}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}</style></head><body><header class="top"><div class="topin"><strong>LIBRA • Accurate Worker</strong><a href="/admin-accurate/auto">← Accurate Auto</a></div></header><main class="wrap"><section class="card"><h1>Force Worker Sekarang</h1><p>Menjalankan satu siklus worker yang sama dengan jadwal 5-menit. Tidak ada bypass production gate, database identity, COA, cabang, duplicate guard, atau read-back verification.</p><form method="post"><button class="btn" type="submit">Jalankan 1 Siklus Sekarang</button></form></section><section class="card"><h2>Status: <span class="${cls}">${esc(status)}</span></h2>${error?`<p class="bad">${esc(error)}</p>`:''}${result?`<p><b>Processed:</b> ${Number(result.processed||0)}<br><b>Skipped:</b> ${result.skipped?'YA':'TIDAK'}<br><b>Reason:</b> ${esc(result.reason||'-')}</p><div class="mono">${esc(JSON.stringify(counts,null,2))}</div>`:'<p>Belum dijalankan manual.</p>'}</section><section class="card note"><b>Fail-safe tetap aktif.</b><p>Jika hasil menjadi RECONCILE_REQUIRED atau status posting tidak pasti, jangan jalankan ulang secara buta. Periksa Journal Voucher di Accurate terlebih dahulu.</p></section></main></body></html>`;
}

export default async request=>{
  const session=getAdminSession(request);
  if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);
  if(String(session.role||'').toUpperCase()!=='SUPERADMIN')return new Response('Akses khusus SUPERADMIN.',{status:403});
  let result=null,error='';
  if(request.method==='POST'){
    if(!sameOrigin(request))return new Response('Forbidden',{status:403});
    try{result=await runOnce(session,request);}catch(e){error=clean(e?.message||e,700);await markSystemHeartbeat('ACCURATE_AUTO',{status:'ERROR',message:`FORCE RUN gagal: ${error}`,metadata:{trigger:'SUPERADMIN_FORCE'}}).catch(()=>{});}
  }else if(request.method!=='GET')return new Response('Method not allowed',{status:405});
  return new Response(render(result,error),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
};

export const config={path:'/admin-accurate/force-worker'};
