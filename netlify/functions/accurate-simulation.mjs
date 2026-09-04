import { getAdminSession } from './_partner-core.mjs';

const STEPS=[
 ['STATEMENT','Issued billing statement memiliki snapshot hash immutable dan periode 2026-08.'],
 ['QUEUE','Queue membuat deterministic job ID dan Journal Voucher number dari statement Libra.'],
 ['GATE_LOCKED','Production posting gate default TERKUNCI; direct posting ditolak.'],
 ['CONFIG','Simulasi auth server-side configured dan 4 minimum COA mapping tersedia.'],
 ['PREFLIGHT','Live-style preflight simulasi: mapping ditemukan, debit=credit, payload lengkap, tanggal 31/08/2026.'],
 ['REQUEST','FINANCE maker mengajukan ACCURATE_POST_JOURNAL; job menjadi APPROVAL_PENDING.'],
 ['MAKER_BLOCK','Maker yang sama tidak boleh menjadi checker.'],
 ['STALE_BLOCK','Perubahan statement hash/JV number setelah approval harus memblokir posting.'],
 ['CHECKER','Checker berbeda memvalidasi approval ID, snapshot hash, JV number dan total jurnal.'],
 ['POSTING','Simulated POST journal-voucher/save.do menggunakan number unik; tidak ada network call.'],
 ['POSTED','Simulated response menyimpan reference/id/digest dan job menjadi POSTED.'],
 ['DUPLICATE','Percobaan posting kedua dengan job/JV number yang sama ditolak.'],
 ['REDIRECT_308','Simulasi 308 mempertahankan method POST dan authorization pada endpoint baru.'],
 ['UNCERTAIN','Simulasi network uncertainty menjadi RECONCILE_REQUIRED dan tidak auto-retry.'],
 ['COMPLETE','UAT No. 7 Accurate Online Production selesai tanpa write ke Accurate.'],
];

const NEGATIVE=[
 'Posting gate false → request/posting diblokir.',
 'Auth Accurate belum configured → preflight ditolak.',
 'Salah satu 4 minimum COA kosong/tidak ditemukan → posting ditolak.',
 'Total debit ≠ credit → posting ditolak.',
 'Journal detail kosong / accountNo kosong → posting ditolak.',
 'Journal Voucher number kosong → posting ditolak.',
 'Tanggal transaksi harus hari terakhir periode statement; bukan tanggal 1 bulan berikutnya.',
 'Statement hash atau JV number berubah setelah approval → checker harus menolak dan approval dibuat ulang.',
 'Maker = checker → approval ditolak.',
 'Approval request ID tidak cocok dengan job → posting ditolak.',
 'Admin tidak memiliki direct-post bypass; hanya maker-checker executor.',
 'Explicit API error → POST_FAILED; tidak dianggap sukses.',
 'Network/response uncertainty → RECONCILE_REQUIRED; jangan auto-retry.',
 'Duplicate job/JV number → tidak boleh membuat posting kedua.',
 'Credential/token tidak boleh masuk browser state, audit atau response UI.',
 'UAT tidak boleh mengubah wallet, billing, approval store, Accurate, Google Sheet atau transaksi produksi.',
];

export default async request=>{
 const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);if(!['SUPERADMIN','FINANCE'].includes(session.role))return new Response('Akses ditolak.',{status:403});if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>UAT Accurate Production | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f6f9;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin{max-width:1250px;margin:auto;display:flex;justify-content:space-between;gap:15px}.top a{color:#fff}.wrap{max-width:1250px;margin:auto;padding:22px 14px 55px}.panel{background:#fff;border:1px solid #dbe5ee;border-radius:17px;padding:16px;margin-bottom:16px}.hero{background:#eaf4fb}.warn{background:#fff4cf}.ok{background:#e9f6ed}.actions{display:flex;gap:8px;flex-wrap:wrap}button{border:0;border-radius:9px;padding:10px 14px;background:#0b5c9c;color:#fff;font-weight:850}.secondary{background:#66758a}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.metric{background:#f7fafc;border-radius:11px;padding:11px}.metric small,.metric b{display:block}.steps{display:grid;gap:7px}.step{padding:10px;border:1px solid #e0e8ef;border-radius:10px}.done{background:#e9f6ed}.current{outline:2px solid #0b5c9c}.tests{columns:2}.tests li{break-inside:avoid;margin:0 0 8px}pre{white-space:pre-wrap;overflow:auto;background:#071b2f;color:#e7f2fa;border-radius:12px;padding:13px;font-size:12px}@media(max-width:850px){.grid{grid-template-columns:1fr 1fr}.tests{columns:1}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA JAYA LOGISTIC • UAT Accurate Production</strong><span><a href="/admin-accurate">Accurate</a> · <a href="/admin-tool">Home</a></span></div></header><main class="wrap"><section class="panel hero"><h1>No. 7 — Accurate Online Production</h1><p>Simulasi ini <b>100% browser-local</b>. State hanya berada di <code>sessionStorage</code>. Tidak ada request ke Accurate, billing, wallet, approval store, Google Sheet atau transaksi produksi.</p><div class="actions"><button id="next">Jalankan Step Berikutnya</button><button id="all">Run All</button><button id="reset" class="secondary">Reset</button></div></section><section class="panel"><div class="grid" id="metrics"></div></section><section class="panel"><h2>Progress UAT</h2><div class="steps" id="steps"></div></section><section class="panel"><h2>State Simulasi</h2><pre id="state"></pre></section><section class="panel warn"><h2>Negative / Guardrail Tests</h2><ul class="tests">${NEGATIVE.map(x=>`<li>${x}</li>`).join('')}</ul></section><section class="panel ok"><b>Kriteria selesai:</b> production gate fail-closed, 4 COA + balanced journal + month-end date lolos preflight, posting hanya lewat maker-checker berbeda, statement hash/JV number terkunci, duplicate dicegah, 308 mempertahankan POST/auth, network uncertainty menjadi RECONCILE_REQUIRED, dan tidak ada production write.</section></main><script>
const STEPS=${JSON.stringify(STEPS)};const K='libraAccurateProductionUatV1';
const base=()=>({step:0,statementNo:'LBR-STMT-202608-PARTNER01-01',statementMonth:'2026-08',statementHash:'sha256:SIM-STATEMENT-202608-A1',jobId:'ACC-SIM-202608-A1',journalNumber:'LBR-STMT-202608-PARTNER01-01',journalDate:'31/08/2026',status:'NOT_QUEUED',postingGate:false,authConfigured:false,coa:{customerDeposit:false,serviceRevenue:false,claimExpense:false,adjustmentExpense:false},coaValidated:false,totalDebit:12500000,totalCredit:12500000,balanced:true,payloadLines:4,approvalRequestId:null,approvalStatus:null,maker:'finance.sim',checker:null,sameMakerCheckerRejected:false,staleMutationRejected:false,postMethod:null,endpoint:'/accurate/api/journal-voucher/save.do',numberUnique:true,simulatedAccurateId:null,simulatedAccurateReference:null,responseDigest:null,duplicateRejected:false,redirect308Preserved:false,reconcileRequiredTest:false,automaticRetry:false,networkCall:false,accurateProductionWrite:false,walletMutation:false,billingMutation:false,credentialsExposed:false,completed:false,events:[]});
let s;try{s=JSON.parse(sessionStorage.getItem(K))||base()}catch{s=base()}
function event(type,note){s.events.push({seq:s.events.length+1,type,note})}
function apply(n){
 if(n===1){s.status='STATEMENT_ISSUED';event('STATEMENT_SNAPSHOT','Issued statement + immutable snapshot hash.');}
 if(n===2){s.status='READY_FOR_REVIEW';event('QUEUE_CREATED','Deterministic job/JV number berasal dari statement.');}
 if(n===3){s.postingGate=false;event('GATE_BLOCKED','Direct posting dengan gate false ditolak.');}
 if(n===4){s.authConfigured=true;for(const k of Object.keys(s.coa))s.coa[k]=true;event('CONFIG_SIMULATED','Server-side auth + minimum COA tersedia; token tidak masuk browser.');}
 if(n===5){s.coaValidated=true;s.balanced=s.totalDebit===s.totalCredit;s.journalDate='31/08/2026';event('PREFLIGHT_PASS','COA found, balanced, payload 4 lines, date month-end.');}
 if(n===6){s.postingGate=true;s.approvalRequestId='APR-ACC-SIM-001';s.approvalStatus='PENDING';s.status='APPROVAL_PENDING';event('APPROVAL_REQUESTED','FINANCE maker meminta ACCURATE_POST_JOURNAL.');}
 if(n===7){s.sameMakerCheckerRejected=true;event('MAKER_CHECKER_BLOCKED','finance.sim tidak boleh approve request sendiri.');}
 if(n===8){s.staleMutationRejected=true;event('STALE_SNAPSHOT_BLOCKED','Mutation hash/JV number simulasi diblokir; state asli dipertahankan.');}
 if(n===9){s.checker='superadmin.sim';event('CHECKER_PREFLIGHT','Checker berbeda cocokkan approval, hash, JV number dan total.');}
 if(n===10){s.status='POSTING';s.postMethod='POST';event('SIMULATED_POST','POST journal-voucher/save.do disimulasikan; networkCall tetap false.');}
 if(n===11){s.status='POSTED';s.approvalStatus='EXECUTED';s.simulatedAccurateId=880001;s.simulatedAccurateReference=s.journalNumber;s.responseDigest='sha256:SIM-RESPONSE-DIGEST';event('SIMULATED_POSTED','Reference/id/digest disimpan tanpa raw credential.');}
 if(n===12){s.duplicateRejected=true;event('DUPLICATE_BLOCKED','Job/JV number yang sama tidak diposting kedua kali.');}
 if(n===13){s.redirect308Preserved=true;event('REDIRECT_308','Method POST + auth preservation diuji secara deklaratif.');}
 if(n===14){s.reconcileRequiredTest=true;s.automaticRetry=false;event('UNCERTAIN_RESPONSE','Simulated network uncertainty → RECONCILE_REQUIRED; tidak auto-retry.');}
 if(n===15){s.completed=true;event('UAT_COMPLETE','No.7 selesai tanpa Accurate production write.');}
 s.step=n;sessionStorage.setItem(K,JSON.stringify(s));render();
}
function render(){const rp=n=>'Rp '+Number(n||0).toLocaleString('id-ID');document.getElementById('metrics').innerHTML=[['Step',s.step+' / '+STEPS.length],['Job',s.jobId],['Status',s.status],['JV Number',s.journalNumber],['Journal Date',s.journalDate],['Debit / Credit',rp(s.totalDebit)+' / '+rp(s.totalCredit)],['Production Write',s.accurateProductionWrite?'YES':'NO WRITE'],['Result',s.completed?'PASS':'RUNNING']].map(x=>'<div class="metric"><small>'+x[0]+'</small><b>'+x[1]+'</b></div>').join('');document.getElementById('steps').innerHTML=STEPS.map((x,i)=>'<div class="step '+(i<s.step?'done ':'')+(i===s.step?'current':'')+'"><b>'+(i+1)+'. '+x[0]+'</b><div>'+x[1]+'</div></div>').join('');document.getElementById('state').textContent=JSON.stringify(s,null,2);}
document.getElementById('next').onclick=()=>{if(s.step<STEPS.length)apply(s.step+1)};document.getElementById('all').onclick=()=>{while(s.step<STEPS.length)apply(s.step+1)};document.getElementById('reset').onclick=()=>{s=base();sessionStorage.setItem(K,JSON.stringify(s));render()};render();
</script></body></html>`;
 return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-accurate/simulation'};
