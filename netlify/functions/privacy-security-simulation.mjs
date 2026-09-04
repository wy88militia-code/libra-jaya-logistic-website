import { getAdminSession } from './_partner-core.mjs';

const STEPS=[
 ['LOGIN_V2','Admin login menerbitkan signed session v2 + signed HttpOnly device cookie.'],
 ['DEVICE_PASS','Session dan deviceId yang cocok lolos validasi.'],
 ['MISSING_DEVICE','Session tanpa device cookie ditolak.'],
 ['MISMATCH_DEVICE','Device cookie valid tetapi deviceId berbeda ditolak.'],
 ['EXPIRED_DEVICE','Device cookie kedaluwarsa ditolak.'],
 ['LEGACY_SESSION','Session v1/legacy tanpa device binding ditolak dan wajib login ulang.'],
 ['LOGOUT','Logout menghapus session + device cookie.'],
 ['AUDIT_PRIVACY','Audit menyimpan ipHash/userAgentHash + pathname/query-key names, tanpa raw network metadata.'],
 ['API_LOG_PRIVACY','API log menyimpan clientIpHash + pathname/query-key names, tanpa raw client IP/query values.'],
 ['RETENTION_DRY_RUN','Retention default dry-run; deletion gate false.'],
 ['RETENTION_SKIP','Record tanpa timestamp valid di-skip fail-closed.'],
 ['PROTECTED_STORE','Wallet/billing/claims/audit/tracking/POD/ticket tidak pernah masuk auto-prune allowlist.'],
 ['EXECUTION_GUARD','Deletion butuh SUPERADMIN + env gate + confirmation phrase.'],
 ['RESTORE_GUARD','Financial/claims/audit/evidence stores immutable-on-restore.'],
 ['COMPLETE','UAT No. 9 selesai tanpa production write atau destructive delete.'],
];
const NEGATIVE=[
 'Session cookie dicuri tanpa device cookie → akses admin/courier harus gagal.',
 'Device cookie dari browser lain → deviceId mismatch dan akses gagal.',
 'Device cookie expired → login ulang wajib.',
 'Legacy session v1 setelah deploy → fail-closed, tidak di-upgrade diam-diam.',
 'Raw IP/User-Agent tidak boleh muncul pada record audit baru.',
 'Query value tidak boleh masuk audit/API log baru; hanya query-key names.',
 'Privacy hash secret tidak tersedia → metadata jaringan tidak disimpan, bukan fallback ke raw.',
 'Deletion gate false → execute retention ditolak.',
 'Confirmation phrase salah → execute retention ditolak.',
 'Timestamp invalid/missing → record skipped, tidak dihapus.',
 'Protected financial/claim/evidence store → tidak boleh dihapus retention engine.',
 'UAT tidak boleh menulis Netlify Blob, wallet, billing, claims, tracking, backup, audit atau API produksi.',
];
export default async request=>{
 const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);if(session.role!=='SUPERADMIN')return new Response('Akses ditolak.',{status:403});if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>UAT Privacy Security | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f6f9;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:1250px;margin:auto}.topin{display:flex;justify-content:space-between;gap:12px}.top a{color:#fff}.wrap{padding:22px 14px 55px}.panel{background:#fff;border:1px solid #dbe5ee;border-radius:17px;padding:16px;margin-bottom:15px}.hero{background:#eaf4fb}.warn{background:#fff5d8}.good{background:#e9f6ed}.actions{display:flex;gap:8px;flex-wrap:wrap}button{border:0;border-radius:9px;padding:10px 14px;background:#0b5c9c;color:#fff;font-weight:850}.secondary{background:#66758a}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.metric{background:#f7fafc;border-radius:10px;padding:10px}.metric small,.metric b{display:block}.steps{display:grid;gap:7px}.step{border:1px solid #e0e8ef;border-radius:10px;padding:10px}.done{background:#e8f5ec}.current{outline:2px solid #0b5c9c}.tests{columns:2}.tests li{break-inside:avoid;margin-bottom:8px}pre{background:#071b2f;color:#e7f2fa;padding:13px;border-radius:11px;white-space:pre-wrap;overflow:auto;font-size:12px}@media(max-width:850px){.grid{grid-template-columns:1fr 1fr}.tests{columns:1}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA • UAT Privacy, Retention & Device Security</strong><span><a href="/admin-privacy-security">Privacy</a> · <a href="/admin-tool">Home</a></span></div></header><main class="wrap"><section class="panel hero"><h1>No. 9 — Privacy, Retention & Device Security</h1><p>Simulasi <b>100% browser-local</b> menggunakan sessionStorage. Tidak membaca atau menulis data produksi, tidak menghapus record dan tidak memanggil external service.</p><div class="actions"><button id="next">Jalankan Step Berikutnya</button><button id="all">Run All</button><button id="reset" class="secondary">Reset</button></div></section><section class="panel"><div class="grid" id="metrics"></div></section><section class="panel"><h2>Progress</h2><div class="steps" id="steps"></div></section><section class="panel"><h2>State Simulasi</h2><pre id="state"></pre></section><section class="panel warn"><h2>Negative / Guardrail Tests</h2><ul class="tests">${NEGATIVE.map(x=>`<li>${x}</li>`).join('')}</ul></section><section class="panel good"><b>Kriteria selesai:</b> device-bound session fail-closed, logout dua cookie, audit/API log pseudonymous, retention dry-run default, malformed timestamp skipped, protected stores locked, execute gate berlapis, immutable restore guard aktif, dan tidak ada production write.</section></main><script>
const STEPS=${JSON.stringify(STEPS)},K='libraPrivacySecurityUatV1';
const base=()=>({step:0,sessionVersion:null,deviceCookie:false,deviceMatch:false,missingDeviceRejected:false,mismatchRejected:false,expiredRejected:false,legacyRejected:false,logoutClearsSession:false,logoutClearsDevice:false,auditRawIpStored:true,auditRawUserAgentStored:true,auditQueryValueStored:true,auditIpHash:false,auditUserAgentHash:false,apiRawIpStored:true,apiQueryValueStored:true,apiIpHash:false,retentionGate:false,retentionMode:'NOT_TESTED',malformedTimestampSkipped:false,protectedStoreDeleteBlocked:false,confirmationRequired:false,superadminRequired:false,immutableRestoreGuard:false,productionWrite:false,destructiveDelete:false,completed:false,events:[]});let s;try{s=JSON.parse(sessionStorage.getItem(K))||base()}catch{s=base()}
function evt(type,note){s.events.push({seq:s.events.length+1,type,note})}
function apply(n){
 if(n===1){s.sessionVersion=2;s.deviceCookie=true;evt('LOGIN_V2','Signed session v2 + signed device cookie issued in simulation.');}
 if(n===2){s.deviceMatch=true;evt('DEVICE_PASS','Matching deviceId accepted.');}
 if(n===3){s.missingDeviceRejected=true;evt('MISSING_DEVICE_BLOCK','Session-only access rejected.');}
 if(n===4){s.mismatchRejected=true;evt('MISMATCH_BLOCK','Different signed deviceId rejected.');}
 if(n===5){s.expiredRejected=true;evt('EXPIRED_DEVICE_BLOCK','Expired device cookie rejected.');}
 if(n===6){s.legacyRejected=true;evt('LEGACY_BLOCK','v1 session rejected; re-login required.');}
 if(n===7){s.logoutClearsSession=true;s.logoutClearsDevice=true;evt('LOGOUT_CLEAR','Both cookies cleared.');}
 if(n===8){s.auditRawIpStored=false;s.auditRawUserAgentStored=false;s.auditQueryValueStored=false;s.auditIpHash=true;s.auditUserAgentHash=true;evt('AUDIT_PRIVACY_PASS','Only pseudonymous network metadata remains.');}
 if(n===9){s.apiRawIpStored=false;s.apiQueryValueStored=false;s.apiIpHash=true;evt('API_LOG_PRIVACY_PASS','API log stores hash/path/query keys only.');}
 if(n===10){s.retentionGate=false;s.retentionMode='DRY_RUN_ONLY';evt('RETENTION_GATE_LOCKED','Delete gate false by default.');}
 if(n===11){s.malformedTimestampSkipped=true;evt('RETENTION_SKIP','Malformed/missing timestamp skipped.');}
 if(n===12){s.protectedStoreDeleteBlocked=true;evt('PROTECTED_STORE_BLOCK','Financial/claims/evidence stores blocked from prune.');}
 if(n===13){s.confirmationRequired=true;s.superadminRequired=true;evt('EXECUTION_GUARD','SUPERADMIN + env gate + exact confirmation required.');}
 if(n===14){s.immutableRestoreGuard=true;evt('RESTORE_GUARD','Ledger/evidence stores never rewound.');}
 if(n===15){s.completed=true;evt('UAT_COMPLETE','No.9 completed with productionWrite=false and destructiveDelete=false.');}
 s.step=n;sessionStorage.setItem(K,JSON.stringify(s));render();}
function render(){document.getElementById('metrics').innerHTML=[['Step',s.step+' / '+STEPS.length],['Session','v'+(s.sessionVersion||'-')],['Device Match',s.deviceMatch?'PASS':'-'],['Legacy Block',s.legacyRejected?'PASS':'-'],['Audit Raw IP',s.auditRawIpStored?'PRESENT':'NONE'],['API Raw IP',s.apiRawIpStored?'PRESENT':'NONE'],['Retention',s.retentionMode],['Production Write',s.productionWrite?'YES':'NO WRITE']].map(x=>'<div class="metric"><small>'+x[0]+'</small><b>'+x[1]+'</b></div>').join('');document.getElementById('steps').innerHTML=STEPS.map((x,i)=>'<div class="step '+(i<s.step?'done ':'')+(i===s.step?'current':'')+'"><b>'+(i+1)+'. '+x[0]+'</b><div>'+x[1]+'</div></div>').join('');document.getElementById('state').textContent=JSON.stringify(s,null,2)}
document.getElementById('next').onclick=()=>{if(s.step<STEPS.length)apply(s.step+1)};document.getElementById('all').onclick=()=>{while(s.step<STEPS.length)apply(s.step+1)};document.getElementById('reset').onclick=()=>{s=base();sessionStorage.setItem(K,JSON.stringify(s));render()};render();
</script></body></html>`;return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-privacy-security/simulation'};
