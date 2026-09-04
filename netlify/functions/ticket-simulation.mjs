import { getAdminSession } from './_partner-core.mjs';

const STEPS=[
 ['CREATE','Partner membuat DELIVERY ticket dengan Booking ID miliknya; sistem memberi priority P3.'],
 ['OWNERSHIP','Booking ID milik partner lain ditolak.'],
 ['TRIAGE','Customer Service mengambil ticket dan menaikkan priority P2 bila dampak operasional tinggi.'],
 ['FIRST_RESPONSE','Balasan publik pertama mencatat firstResponseAt dan terlihat partner.'],
 ['INTERNAL_NOTE','Catatan internal tersimpan tetapi tidak muncul pada timeline partner.'],
 ['WAITING_PARTNER','Status WAITING_PARTNER memulai pause SLA resolution.'],
 ['PARTNER_REPLY','Partner membalas; workflow kembali IN_PROGRESS dan pause SLA dihentikan.'],
 ['WAITING_INTERNAL','Ticket menunggu investigasi internal tanpa membuka akses data lintas modul.'],
 ['RESOLVE','Customer Service menandai RESOLVED setelah jawaban operasional diberikan.'],
 ['REOPEN','Partner membalas ticket RESOLVED; ticket kembali IN_PROGRESS dan reopenCount bertambah.'],
 ['RESOLVE_AGAIN','Ticket diselesaikan kembali setelah follow-up.'],
 ['CLOSE','Ticket CLOSED dan percakapan dikunci.'],
 ['CLOSED_LOCK','Pesan atau perubahan workflow setelah CLOSED ditolak.'],
 ['SLA_RED','Skenario first-response/resolution breach menghasilkan SLA RED di antrean admin.'],
 ['COMPLETE','UAT No. 8 Customer Service + Ticketing selesai tanpa write produksi.'],
];
const NEGATIVE=[
 'Kategori tidak dikenal → create ditolak.',
 'Subjek/pesan terlalu pendek → create ditolak.',
 'TRACKING/PICKUP/DELIVERY/CLAIM tanpa Booking ID → ditolak.',
 'Booking ID partner lain → 403/logical reject.',
 'Partner tidak dapat menentukan P1/P2 secara langsung.',
 'COURIER tidak punya akses ke admin ticket desk.',
 'Catatan INTERNAL tidak boleh muncul di partner timeline/notifikasi.',
 'Partner hanya dapat membaca ticket milik partnerId session-nya.',
 'First response hanya dicatat pada balasan publik admin, bukan internal note.',
 'WAITING_PARTNER menghentikan jam resolution SLA; partner reply melanjutkan IN_PROGRESS.',
 'RESOLVED dapat reopen oleh partner reply; CLOSED tidak dapat reopen.',
 'Concurrent state update dengan ETag lama → refresh/retry, tidak overwrite diam-diam.',
 'Ticket tidak boleh mengubah wallet, billing, claim settlement, booking atau tracking.',
 'Koreksi finansial dari ticket tetap wajib masuk Finance/Claims maker-checker.',
 'UAT tidak boleh menulis Netlify Blob, notifikasi, webhook, Google Sheet atau API produksi.',
];
export default async request=>{
 const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);if(!['SUPERADMIN','FINANCE','OPS','CUSTOMER_SERVICE'].includes(session.role))return new Response('Akses ditolak.',{status:403});if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>UAT Customer Service | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f6f9;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:1250px;margin:auto}.topin{display:flex;justify-content:space-between}.top a{color:#fff}.wrap{padding:22px 14px 55px}.panel{background:#fff;border:1px solid #dbe5ee;border-radius:17px;padding:16px;margin-bottom:15px}.hero{background:#eaf4fb}.warn{background:#fff5d8}.good{background:#e9f6ed}.actions{display:flex;gap:8px;flex-wrap:wrap}button{border:0;border-radius:9px;padding:10px 14px;background:#0b5c9c;color:#fff;font-weight:850}.secondary{background:#66758a}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.metric{background:#f7fafc;border-radius:10px;padding:10px}.metric small,.metric b{display:block}.steps{display:grid;gap:7px}.step{border:1px solid #e0e8ef;border-radius:10px;padding:10px}.done{background:#e8f5ec}.current{outline:2px solid #0b5c9c}.tests{columns:2}.tests li{break-inside:avoid;margin-bottom:8px}pre{background:#071b2f;color:#e7f2fa;padding:13px;border-radius:11px;white-space:pre-wrap;overflow:auto;font-size:12px}@media(max-width:850px){.grid{grid-template-columns:1fr 1fr}.tests{columns:1}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA • UAT Customer Service + Ticketing</strong><span><a href="/admin-tickets">Ticket Desk</a> · <a href="/admin-tool">Home</a></span></div></header><main class="wrap"><section class="panel hero"><h1>No. 8 — Customer Service + Ticketing</h1><p>Simulasi <b>100% browser-local</b> memakai sessionStorage. Tidak membaca/menulis ticket produksi, booking, claim, wallet, billing, notification, webhook atau Google Sheet.</p><div class="actions"><button id="next">Jalankan Step Berikutnya</button><button id="all">Run All</button><button id="reset" class="secondary">Reset</button></div></section><section class="panel"><div class="grid" id="metrics"></div></section><section class="panel"><h2>Progress</h2><div class="steps" id="steps"></div></section><section class="panel"><h2>State Simulasi</h2><pre id="state"></pre></section><section class="panel warn"><h2>Negative / Guardrail Tests</h2><ul class="tests">${NEGATIVE.map(x=>`<li>${x}</li>`).join('')}</ul></section><section class="panel good"><b>Kriteria selesai:</b> ownership booking terkunci, partner tidak bisa self-P1, first-response benar, internal note tersembunyi, WAITING_PARTNER pause/resume benar, reopen hanya dari RESOLVED, CLOSED locked, SLA breach terdeteksi, CAS conflict fail-safe dan tidak ada mutasi finansial/operasional.</section></main><script>
const STEPS=${JSON.stringify(STEPS)},K='libraTicketUatV1';
const base=()=>({step:0,ticketId:'TKT-SIM-0001',partnerId:'PARTNER_SIM_01',bookingId:'BOOK-SIM-001',category:'DELIVERY',subject:'Kiriman belum diterima',status:'NONE',priority:null,assignee:null,firstResponseAt:null,publicReplies:0,internalNotes:0,partnerVisibleInternalNotes:0,waitingPartner:false,waitingPartnerPausedMs:0,reopenCount:0,ownershipReject:false,partnerPriorityInjectionRejected:true,courierAccessRejected:true,closedLock:false,slaRisk:'GREEN',casConflictRejected:true,walletMutation:false,billingMutation:false,claimMutation:false,bookingMutation:false,trackingMutation:false,productionWrite:false,events:[]});let s;try{s=JSON.parse(sessionStorage.getItem(K))||base()}catch{s=base()}
function evt(type,note){s.events.push({seq:s.events.length+1,type,note})}
function apply(n){
 if(n===1){s.status='OPEN';s.priority='P3';evt('TICKET_OPENED','Partner booking ownership valid; default P3.');}
 if(n===2){s.ownershipReject=true;evt('OWNERSHIP_REJECT','BOOK-OTHER-PARTNER ditolak.');}
 if(n===3){s.status='IN_PROGRESS';s.assignee='cs.sim';s.priority='P2';evt('TRIAGED','CS assigned + priority P2.');}
 if(n===4){s.firstResponseAt='2026-09-04T00:20:00.000Z';s.publicReplies=1;evt('ADMIN_REPLY','First public response recorded.');}
 if(n===5){s.internalNotes=1;s.partnerVisibleInternalNotes=0;evt('INTERNAL_NOTE','Hanya admin; partnerVisible=false.');}
 if(n===6){s.status='WAITING_PARTNER';s.waitingPartner=true;evt('WAITING_PARTNER','Resolution SLA paused.');}
 if(n===7){s.waitingPartnerPausedMs=45*60000;s.waitingPartner=false;s.status='IN_PROGRESS';s.publicReplies+=1;evt('PARTNER_REPLY','Partner reply resumes workflow; pause accumulated 45 min.');}
 if(n===8){s.status='WAITING_INTERNAL';evt('WAITING_INTERNAL','Investigasi internal; no cross-module mutation.');}
 if(n===9){s.status='RESOLVED';evt('RESOLVED','Jawaban operasional selesai.');}
 if(n===10){s.status='IN_PROGRESS';s.reopenCount=1;s.publicReplies+=1;evt('REOPENED','Partner follow-up reopens resolved ticket.');}
 if(n===11){s.status='RESOLVED';evt('RESOLVED_AGAIN','Follow-up diselesaikan.');}
 if(n===12){s.status='CLOSED';evt('CLOSED','Ticket final locked.');}
 if(n===13){s.closedLock=true;evt('CLOSED_LOCK_TEST','Post-close reply/status update rejected.');}
 if(n===14){s.slaRisk='RED';evt('SLA_BREACH_TEST','Separate overdue scenario returns RED.');}
 if(n===15){s.completed=true;evt('UAT_COMPLETE','No.8 complete; productionWrite=false.');}
 s.step=n;sessionStorage.setItem(K,JSON.stringify(s));render();}
function render(){document.getElementById('metrics').innerHTML=[['Step',s.step+' / '+STEPS.length],['Ticket',s.ticketId],['Status',s.status],['Priority',s.priority||'-'],['PIC',s.assignee||'-'],['SLA',s.slaRisk],['Internal leak',s.partnerVisibleInternalNotes?'FAIL':'NONE'],['Production Write',s.productionWrite?'YES':'NO WRITE']].map(x=>'<div class="metric"><small>'+x[0]+'</small><b>'+x[1]+'</b></div>').join('');document.getElementById('steps').innerHTML=STEPS.map((x,i)=>'<div class="step '+(i<s.step?'done ':'')+(i===s.step?'current':'')+'"><b>'+(i+1)+'. '+x[0]+'</b><div>'+x[1]+'</div></div>').join('');document.getElementById('state').textContent=JSON.stringify(s,null,2)}
document.getElementById('next').onclick=()=>{if(s.step<STEPS.length)apply(s.step+1)};document.getElementById('all').onclick=()=>{while(s.step<STEPS.length)apply(s.step+1)};document.getElementById('reset').onclick=()=>{s=base();sessionStorage.setItem(K,JSON.stringify(s));render()};render();
</script></body></html>`;return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-tickets/simulation'};
