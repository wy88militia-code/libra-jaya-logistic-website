import { getAdminSession } from './_partner-core.mjs';

const STEPS=[
 ['INCIDENT','Booking SIM-LBR-CLM-001 memiliki incident DAMAGE dari tracking.'],
 ['OPEN','Buka claim INSURED; status OPEN dan coverage default PENDING_POLICY_TERMS.'],
 ['DUPLICATE','Percobaan claim aktif kedua untuk booking yang sama ditolak.'],
 ['DOC_PENDING','Required docs belum lengkap; settlement belum eligible.'],
 ['POLICY','OPS memasukkan policy reference lalu memutus coverage ELIGIBLE secara manual.'],
 ['DOCUMENTS','INVOICE, AWB, CHRONOLOGY, DAMAGE_PHOTO dan INSURER_FORM dilengkapi.'],
 ['REVIEW','Claim masuk UNDER_REVIEW tanpa mengubah lifecycle tracking.'],
 ['APPROVE','Approved Rp8.000.000, deductible Rp1.000.000, settlement Rp7.000.000.'],
 ['REQUEST','FINANCE maker mengajukan CLAIM_SETTLEMENT; claim menjadi SETTLEMENT_PENDING dan nominal dikunci.'],
 ['CHECKER','Maker yang sama ditolak; checker berbeda mengeksekusi settlement dan claim menjadi SETTLED.'],
 ['CLOSE','Claim ditutup setelah settlement selesai.'],
 ['COMPLETE','UAT No. 6 Claims + Insurance selesai.'],
];

const NEGATIVE=[
 'INSURED claim tidak boleh auto-ELIGIBLE tanpa policy reference / keputusan manual.',
 'Dokumen wajib belum lengkap → settlement ditolak.',
 'Insurance mode UNKNOWN → settlement ditolak.',
 'Claim aktif kedua pada booking yang sama → ditolak.',
 'SETTLEMENT_PENDING / SETTLED tidak dapat dipilih lewat update biasa.',
 'Approved amount / deductible berubah setelah settlement request → ditolak.',
 'Maker = checker → approval ditolak.',
 'Approval request ID, booking, partner atau nominal tidak cocok → wallet credit diblokir.',
 'Settlement REJECTED → claim kembali UNDER_REVIEW.',
 'Claim sync gagal setelah finansial → Sync Hasil Approval menjadi fallback rekonsiliasi.',
 'Concurrent state update → ETag CAS harus memaksa refresh/retry.',
 'Policy wording, insurer SLA, AP dan Accurate Online tidak diasumsikan tersedia.',
];

export default async request=>{
 const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);if(!['SUPERADMIN','FINANCE','OPS','CUSTOMER_SERVICE'].includes(session.role))return new Response('Akses ditolak.',{status:403});if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>UAT Claims & Insurance | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f6f9;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin{max-width:1250px;margin:auto;display:flex;justify-content:space-between;gap:15px}.top a{color:#fff}.wrap{max-width:1250px;margin:auto;padding:22px 14px 55px}.panel{background:#fff;border:1px solid #dbe5ee;border-radius:17px;padding:16px;margin-bottom:16px}.hero{background:#eaf4fb}.warn{background:#fff4cf}.ok{background:#e9f6ed}.actions{display:flex;gap:8px;flex-wrap:wrap}button{border:0;border-radius:9px;padding:10px 14px;background:#0b5c9c;color:#fff;font-weight:850}.secondary{background:#66758a}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.metric{background:#f7fafc;border-radius:11px;padding:11px}.metric small,.metric b{display:block}.steps{display:grid;gap:7px}.step{padding:10px;border:1px solid #e0e8ef;border-radius:10px}.done{background:#e9f6ed}.current{outline:2px solid #0b5c9c}.tests{columns:2}.tests li{break-inside:avoid;margin:0 0 8px}pre{white-space:pre-wrap;overflow:auto;background:#071b2f;color:#e7f2fa;border-radius:12px;padding:13px;font-size:12px}@media(max-width:850px){.grid{grid-template-columns:1fr 1fr}.tests{columns:1}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA JAYA LOGISTIC • UAT Claims & Insurance</strong><span><a href="/admin-claims">Claims</a> · <a href="/admin-tool">Home</a></span></div></header><main class="wrap"><section class="panel hero"><h1>No. 6 — Claims + Insurance Engine</h1><p>Simulasi ini <b>100% browser-local</b>. State hanya berada di <code>sessionStorage</code>; tidak menulis booking, tracking, claim store, approval, billing, wallet, Google Sheet, insurer, AP, atau Accurate Online.</p><div class="actions"><button id="next">Jalankan Step Berikutnya</button><button id="all">Run All</button><button id="reset" class="secondary">Reset</button></div></section><section class="panel"><div class="grid" id="metrics"></div></section><section class="panel"><h2>Progress UAT</h2><div class="steps" id="steps"></div></section><section class="panel"><h2>State Simulasi</h2><pre id="state"></pre></section><section class="panel warn"><h2>Negative / Guardrail Tests</h2><ul class="tests">${NEGATIVE.map(x=>`<li>${x}</li>`).join('')}</ul></section><section class="panel ok"><b>Kriteria selesai:</b> claim INSURED tidak auto-adjudicated, dokumen dan policy gate bekerja, financial status hanya lewat maker-checker, settlement preflight cocok dengan claim, simulated payout tepat Rp7.000.000, claim SETTLED lalu CLOSED, dan tidak ada production write.</section></main><script>
const STEPS=${JSON.stringify(STEPS)};const K='libraClaimUatStateV1';
const base=()=>({step:0,bookingId:'SIM-LBR-CLM-001',trackingIncident:'DAMAGE',trackingLifecycleChanged:false,claimId:null,claimStatus:'NONE',insuranceMode:'INSURED',coverageDecision:'NOT_EVALUATED',policyReference:null,documents:{INVOICE:false,AWB:false,CHRONOLOGY:false,DAMAGE_PHOTO:false,INSURER_FORM:false},documentsComplete:false,duplicateClaimRejected:false,approvedAmount:0,deductibleAmount:0,settlementAmount:0,approvalRequestId:null,approvalStatus:null,maker:'finance.sim',checker:null,sameMakerCheckerRejected:false,amountLocked:false,simulatedWalletCredit:0,walletProductionMutation:false,accuratePosted:false,apPosted:false,closed:false,completed:false,events:[]});
let s;try{s=JSON.parse(sessionStorage.getItem(K))||base()}catch{s=base()}
function event(type,note){s.events.push({seq:s.events.length+1,type,note})}
function apply(n){
 if(n===1)event('INCIDENT_DETECTED','Tracking DAMAGE menjadi bukti operasional; lifecycle claim terpisah.');
 if(n===2){s.claimId='CLM-SIM-001';s.claimStatus='OPEN';s.coverageDecision='PENDING_POLICY_TERMS';event('CLAIM_OPENED','INSURED claim tidak auto-eligible.');}
 if(n===3){s.duplicateClaimRejected=true;event('DUPLICATE_BLOCKED','Active-booking claim lock menolak claim kedua.');}
 if(n===4){s.claimStatus='DOC_PENDING';event('DOC_PENDING','Required docs belum lengkap.');}
 if(n===5){s.policyReference='POL-SIM-2026-001';s.coverageDecision='ELIGIBLE';event('COVERAGE_REVIEWED','Manual OPS decision setelah policy reference.');}
 if(n===6){for(const k of Object.keys(s.documents))s.documents[k]=true;s.documentsComplete=true;event('DOCUMENTS_COMPLETE','Checklist dokumen wajib lengkap.');}
 if(n===7){s.claimStatus='UNDER_REVIEW';event('UNDER_REVIEW','Claim finance/ops review; tracking tidak berubah.');}
 if(n===8){s.claimStatus='APPROVED';s.approvedAmount=8000000;s.deductibleAmount=1000000;s.settlementAmount=7000000;event('CLAIM_APPROVED','Approved 8jt, deductible 1jt.');}
 if(n===9){s.claimStatus='SETTLEMENT_PENDING';s.approvalRequestId='APR-SIM-001';s.approvalStatus='PENDING';s.amountLocked=true;event('SETTLEMENT_REQUESTED','Maker FINANCE mengajukan 7jt.');}
 if(n===10){s.sameMakerCheckerRejected=true;s.checker='superadmin.sim';s.approvalStatus='EXECUTED';s.simulatedWalletCredit=7000000;s.claimStatus='SETTLED';event('MAKER_CHECKER_BLOCKED','finance.sim tidak boleh approve request sendiri.');event('SETTLEMENT_EXECUTED','superadmin.sim preflight cocok; simulated credit 7jt; claim synced SETTLED.');}
 if(n===11){s.claimStatus='CLOSED';s.closed=true;event('CLAIM_CLOSED','Kasus selesai setelah settlement.');}
 if(n===12){s.completed=true;event('UAT_COMPLETE','Semua acceptance step selesai tanpa production write.');}
 s.step=n;sessionStorage.setItem(K,JSON.stringify(s));render();
}
function render(){const rp=n=>'Rp '+Number(n||0).toLocaleString('id-ID');document.getElementById('metrics').innerHTML=[['Step',s.step+' / '+STEPS.length],['Claim',s.claimId||'-'],['Status',s.claimStatus],['Coverage',s.coverageDecision],['Settlement',rp(s.settlementAmount)],['Simulated Credit',rp(s.simulatedWalletCredit)],['Production Wallet',s.walletProductionMutation?'MUTATED':'NO WRITE'],['Result',s.completed?'PASS':'RUNNING']].map(x=>'<div class="metric"><small>'+x[0]+'</small><b>'+x[1]+'</b></div>').join('');document.getElementById('steps').innerHTML=STEPS.map((x,i)=>'<div class="step '+(i<s.step?'done ':'')+(i===s.step?'current':'')+'"><b>'+(i+1)+'. '+x[0]+'</b><div>'+x[1]+'</div></div>').join('');document.getElementById('state').textContent=JSON.stringify(s,null,2);}
document.getElementById('next').onclick=()=>{if(s.step<STEPS.length)apply(s.step+1)};document.getElementById('all').onclick=()=>{while(s.step<STEPS.length){const n=s.step+1;apply(n)}};document.getElementById('reset').onclick=()=>{s=base();sessionStorage.setItem(K,JSON.stringify(s));render()};render();
</script></body></html>`;
 return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-claims/simulation'};
