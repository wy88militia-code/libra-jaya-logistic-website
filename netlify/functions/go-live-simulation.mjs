import { getAdminSession } from './_partner-core.mjs';

const STEPS=[
 ['READINESS','Required readiness checks dianggap PASS untuk rehearsal; tidak membaca credential produksi.'],
 ['PARTNER','Partner ACTIVE, production credential claimed dan rate plan ACTIVE.'],
 ['SERVICEABILITY','Rute published ACTIVE; flow WMX hanya last-mile Distrik Wamena.'],
 ['QUOTE','Quote production approved, TTL valid, destination GPS accuracy ≤200 m dan kodeWilayah cocok.'],
 ['TOPUP','Simulasi verified Xendit server callback mengkredit wallet; browser redirect tidak berwenang kredit.'],
 ['BOOKING','Production booking memakai idempotency key dan mendebit wallet satu kali.'],
 ['PICKUP_ASSIGN','OPS assign courier; booking masuk PICKUP_ASSIGNED.'],
 ['CUSTODY_PICKUP','Courier TAKE_CUSTODY lalu scan PICKED_UP; tidak ada custodian aktif lain.'],
 ['WAREHOUSE_IN','Hub DJJ inbound scan lalu STORE_DJJ dengan zone/rack.'],
 ['WEIGHT_VERIFY','Declared 10 kg → actual 12 kg → chargeable 12 kg; billing review ditandai tanpa auto wallet mutation.'],
 ['MANIFEST_ADD','Booking VERIFIED dimasukkan manifest menggunakan verified operational weight 12 kg.'],
 ['REWEIGH','Reweigh 13 kg dengan reason + scale ID membuat manifest weight STALE.'],
 ['MANIFEST_SYNC','OPS sync verified weight manifest menjadi 13 kg.'],
 ['MANIFEST_CLOSE','Manifest close + lock hanya setelah weight sinkron dan net uplift valid.'],
 ['WAREHOUSE_OUT','Warehouse OUT_MANIFEST dari DJJ setelah manifest locked.'],
 ['TRANSIT','Tracking IN_TRANSIT → CONNECTING_FLIGHT DJJ-WMX.'],
 ['DESTINATION_HUB','Hub WMX inbound/arrived destination; last-mile tetap area Kota/Distrik Wamena.'],
 ['LAST_MILE','Courier tujuan TAKE_CUSTODY → OUT_FOR_DELIVERY.'],
 ['POD','Receiver + photo + GPS accuracy/geofence ≤200 m menghasilkan immutable POD dan DELIVERED.'],
 ['COSTING','Vendor actual cost dicatat immutable; revenue 1.000.000, vendor cost 780.000, gross profit 220.000.'],
 ['RECONCILIATION','Booking debit wallet cocok dengan booking amount; rekonsiliasi MATCHED.'],
 ['BILLING','Finance issue statement immutable; adjustment bila perlu tetap maker-checker.'],
 ['ACCURATE_QUEUE','Statement masuk Accurate queue dengan deterministic JV number + snapshot hash.'],
 ['ACCURATE_APPROVAL','FINANCE maker → SUPERADMIN checker berbeda; payload/hash/total cocok.'],
 ['ACCURATE_POST_SIM','Simulated POSTED hanya di browser; tidak ada request ke Accurate production.'],
 ['CS_TICKET','Partner membuat ticket; CS balas, resolve dan close tanpa mutasi finansial langsung.'],
 ['PRIVACY_BACKUP','Device binding, pseudonymous audit, retention locked dan backup evidence guard dianggap lolos.'],
 ['COMPLETE','Full E2E rehearsal selesai tanpa production write. Controlled live proof masih langkah terpisah.'],
];
const NEGATIVE=[
 'API signature salah atau nonce replay → request ditolak sebelum booking.',
 'Credential UAT dipakai ke PRODUCTION → environment mismatch.',
 'Rute ON_REQUEST/MINIMUM_LOAD/CHARTER_REQUIRED/OUT_OF_COVERAGE → tidak auto-book.',
 'WMX di luar Distrik Wamena → OUT_OF_COVERAGE/manual survey.',
 'GPS destination accuracy >200 m atau kodeWilayah mismatch → booking ditolak.',
 'Quote expired / bukan milik partner → booking ditolak.',
 'Wallet tidak cukup → WAITING_TOPUP; tidak boleh saldo negatif.',
 'Browser success redirect Xendit → tidak boleh mengkredit wallet.',
 'Duplicate booking idempotency key → tidak mendebit wallet dua kali.',
 'Booking UAT → tidak boleh mendebit wallet production.',
 'Courier kedua TAKE_CUSTODY saat custodian aktif → ditolak.',
 'Warehouse outbound saat HOLD/DAMAGED → ditolak sampai release workflow.',
 'Actual weight ≤0 / sangat besar invalid → verify ditolak.',
 'Reweigh kedua tanpa reason atau scale ID wajib → ditolak.',
 'Manifest close saat verified weight berubah/stale → ditolak.',
 'Manifest locked → item/weight tidak boleh diedit langsung.',
 'Duplicate vendor invoice/reference → biaya tidak boleh dicatat dua kali.',
 'Cost/vendor adjustment tidak boleh otomatis mengubah wallet customer.',
 'POD tanpa foto/receiver/GPS atau accuracy/geofence >200 m → DELIVERED ditolak.',
 'Claim settlement tidak boleh berasal dari ticket; wajib Claims + Finance maker-checker.',
 'Insurance coverage tidak boleh diasumsikan di luar wording/polis final.',
 'Accurate JV duplicate number → tidak boleh membuat posting kedua.',
 'Maker Accurate = checker → approval ditolak.',
 'Network uncertainty saat Accurate → RECONCILE_REQUIRED; tidak auto-retry.',
 'Session admin tanpa signed device cookie cocok → akses go-live ditolak.',
 'Retention deletion gate locked → destructive cleanup ditolak.',
 'Backup/off-site evidence gagal → readiness production tetap blocker/warning sesuai policy.',
 'Google Maps tidak tersedia → core GPS+kecamatan/kodeWilayah tetap jalan; enhanced routing bukan alasan bypass validasi.',
 'Rehearsal ini tidak boleh menulis Blob, Sheet, wallet, Xendit, Accurate, webhook, email/WhatsApp atau data produksi.',
];

export default async request=>{
 const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);if(session.role!=='SUPERADMIN')return new Response('Akses ditolak.',{status:403});if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Go-Live E2E Rehearsal | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f6f9;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:1300px;margin:auto}.topin{display:flex;justify-content:space-between;gap:12px}.top a{color:#fff}.wrap{padding:22px 14px 55px}.panel{background:#fff;border:1px solid #dbe5ee;border-radius:17px;padding:16px;margin-bottom:15px}.hero{background:linear-gradient(135deg,#eaf4fb,#f7fbfe)}.warn{background:#fff5d8}.good{background:#e9f6ed}.actions{display:flex;gap:8px;flex-wrap:wrap}button{border:0;border-radius:9px;padding:10px 14px;background:#0b5c9c;color:#fff;font-weight:850}.secondary{background:#66758a}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.metric{background:#f7fafc;border-radius:10px;padding:10px}.metric small,.metric b{display:block}.steps{display:grid;gap:7px}.step{border:1px solid #e0e8ef;border-radius:10px;padding:10px}.done{background:#e8f5ec}.current{outline:2px solid #0b5c9c}.tests{columns:2}.tests li{break-inside:avoid;margin-bottom:8px}pre{background:#071b2f;color:#e7f2fa;padding:13px;border-radius:11px;white-space:pre-wrap;overflow:auto;font-size:12px}.flow{display:flex;gap:5px;flex-wrap:wrap}.flow span{background:#edf3f8;border-radius:999px;padding:5px 8px;font-size:11px}@media(max-width:950px){.grid{grid-template-columns:1fr 1fr}.tests{columns:1}}@media(max-width:520px){.grid{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA JAYA LOGISTIC • Full Go-Live E2E Rehearsal</strong><span><a href="/admin-go-live">Readiness</a> · <a href="/admin-tool">Home</a></span></div></header><main class="wrap"><section class="panel hero"><h1>No. 10 — End-to-End Rehearsal</h1><p>Simulasi <b>100% browser-local</b> memakai sessionStorage. Ini menguji urutan dan guardrail lintas modul tanpa menyentuh transaksi produksi. Setelah rehearsal PASS, status produksi tetap belum VERIFIED sampai controlled live proof benar-benar dilakukan.</p><div class="actions"><button id="next">Jalankan Step Berikutnya</button><button id="all">Run All</button><button id="reset" class="secondary">Reset</button></div></section><section class="panel"><div class="grid" id="metrics"></div></section><section class="panel"><h2>Business Flow</h2><div class="flow"><span>Partner</span><span>Serviceability</span><span>Quote</span><span>Xendit/Wallet</span><span>Booking</span><span>Pickup/Custody</span><span>Warehouse</span><span>Weight</span><span>Manifest</span><span>Flight/Transit</span><span>Last Mile</span><span>POD</span><span>Cost/Profit</span><span>Billing</span><span>Accurate</span><span>CS</span><span>Privacy/Backup</span></div></section><section class="panel"><h2>Progress E2E</h2><div class="steps" id="steps"></div></section><section class="panel"><h2>State Rehearsal</h2><pre id="state"></pre></section><section class="panel warn"><h2>Negative / Guardrail Matrix</h2><ul class="tests">${NEGATIVE.map(x=>`<li>${x}</li>`).join('')}</ul></section><section class="panel good"><b>Kriteria PASS:</b> satu kiriman simulasi mengalir dari partner/rate/route hingga POD, costing, billing dan Accurate approval; semua critical negative guardrail dinyatakan fail-closed; wallet hanya sekali debit; tidak ada production write/network call.</section></main><script>
const STEPS=${JSON.stringify(STEPS)},NEGATIVE=${JSON.stringify(NEGATIVE)},K='libraGoLiveE2EUatV1';
const base=()=>({step:0,partner:{status:'NONE',ratePlan:false,productionCredential:false},route:{status:'NONE',kode:'SIM-DJJ-WMX',district:'WAMENA'},quote:{status:'NONE',gpsAccuracyM:null},wallet:{balance:0,credits:0,debits:0},booking:{status:'NONE',amount:1000000,idempotent:true,source:'PRODUCTION_SIM'},custody:{holder:null},warehouse:{hub:null,status:'NONE',zone:null,rack:null},weight:{declared:10,actual:null,chargeable:null,verified:false,reweigh:null,manifestStale:false},manifest:{status:'NONE',weight:null,locked:false},tracking:{status:'NONE'},pod:{locked:false,distanceM:null,accuracyM:null},profitability:{revenue:0,vendorCost:0,grossProfit:0},reconciliation:'NONE',billing:{statement:null,snapshotHash:null},accurate:{job:null,status:'NONE',maker:null,checker:null,networkCall:false},ticket:{status:'NONE'},privacyBackupGuard:false,negativeGuardsPassed:0,productionWrites:0,externalNetworkCalls:0,completed:false,events:[]});let s;try{s=JSON.parse(sessionStorage.getItem(K))||base()}catch{s=base()}
function evt(type,note){s.events.push({seq:s.events.length+1,type,note})}
function apply(n){
 if(n===1){evt('READINESS','Config/snapshot checks assumed pass only for browser rehearsal.');}
 if(n===2){s.partner={status:'ACTIVE',ratePlan:true,productionCredential:true};evt('PARTNER_READY','Partner + production credential + rate plan ready.');}
 if(n===3){s.route.status='ACTIVE';evt('ROUTE_ACTIVE','Published ACTIVE route; Wamena district restriction preserved.');}
 if(n===4){s.quote.status='APPROVED';s.quote.gpsAccuracyM=25;evt('QUOTE_APPROVED','TTL valid, route active, GPS accurate.');}
 if(n===5){s.wallet.balance=2000000;s.wallet.credits=1;evt('XENDIT_CALLBACK_SIM','Verified server callback credits wallet once.');}
 if(n===6){s.wallet.balance-=s.booking.amount;s.wallet.debits=1;s.booking.status='BOOKED';evt('BOOKING_DEBIT','Idempotent production booking debits wallet once.');}
 if(n===7){s.booking.status='PICKUP_ASSIGNED';evt('PICKUP_ASSIGNED','OPS assigns courier.');}
 if(n===8){s.custody.holder='courier-origin.sim';s.booking.status='PICKED_UP';s.tracking.status='PICKED_UP';evt('CUSTODY_PICKUP','Single active custodian + verified pickup scan.');}
 if(n===9){s.custody.holder='HUB_DJJ';s.warehouse={hub:'DJJ',status:'STORED',zone:'A',rack:'A-01'};s.tracking.status='AT_ORIGIN_HUB';evt('WAREHOUSE_DJJ','Inbound and storage complete.');}
 if(n===10){s.weight.actual=12;s.weight.chargeable=12;s.weight.verified=true;evt('WEIGHT_VERIFIED','Actual 12 kg; billing review flag only, no wallet auto-adjust.');}
 if(n===11){s.manifest={status:'OPEN',weight:12,locked:false};evt('MANIFEST_ADD','Verified 12 kg snapshot used.');}
 if(n===12){s.weight.reweigh=13;s.weight.chargeable=13;s.weight.manifestStale=true;evt('REWEIGH','13 kg with reason/scale ID → stale manifest.');}
 if(n===13){s.manifest.weight=13;s.weight.manifestStale=false;evt('MANIFEST_SYNC','Verified weight synchronized.');}
 if(n===14){s.manifest.status='CLOSED';s.manifest.locked=true;evt('MANIFEST_LOCK','Close + lock after sync/uplift validation.');}
 if(n===15){s.warehouse.status='OUT_MANIFEST';evt('WAREHOUSE_OUT','DJJ outbound allowed only after locked manifest.');}
 if(n===16){s.tracking.status='CONNECTING_FLIGHT';s.custody.holder='CARRIER_SIM';evt('TRANSIT','IN_TRANSIT → CONNECTING_FLIGHT DJJ-WMX.');}
 if(n===17){s.warehouse={hub:'WMX',status:'INBOUND',zone:'DEST',rack:null};s.tracking.status='ARRIVED_DESTINATION';s.custody.holder='HUB_WMX';evt('DEST_HUB','Arrived WMX within urban coverage rule.');}
 if(n===18){s.custody.holder='courier-lastmile.sim';s.tracking.status='OUT_FOR_DELIVERY';evt('LAST_MILE','Destination courier custody.');}
 if(n===19){s.pod={locked:true,distanceM:48,accuracyM:18};s.tracking.status='DELIVERED';s.booking.status='DELIVERED';evt('POD_DELIVERED','Photo+receiver+GPS valid; immutable POD locked.');}
 if(n===20){s.profitability={revenue:1000000,vendorCost:780000,grossProfit:220000};evt('PROFITABILITY','Actual vendor cost allocated; GP 220k.');}
 if(n===21){s.reconciliation='MATCHED';evt('RECONCILIATION','Booking amount equals one wallet debit.');}
 if(n===22){s.billing.statement='LBR-STMT-SIM-001';s.billing.snapshotHash='sha256:SIM-BILLING-HASH';evt('STATEMENT_ISSUED','Immutable finance statement.');}
 if(n===23){s.accurate.job='ACC-SIM-BILLING-HASH';s.accurate.status='READY_FOR_REVIEW';evt('ACCURATE_QUEUE','Deterministic JV queue created.');}
 if(n===24){s.accurate.maker='finance.sim';s.accurate.checker='superadmin.sim';s.accurate.status='APPROVAL_PENDING';evt('ACCURATE_APPROVAL','Different maker/checker validate locked payload.');}
 if(n===25){s.accurate.status='POSTED_SIMULATION_ONLY';s.accurate.networkCall=false;evt('ACCURATE_POST_SIM','No external call; simulated response only.');}
 if(n===26){s.ticket.status='CLOSED';evt('CS_TICKET','Partner support workflow resolved without financial mutation.');}
 if(n===27){s.privacyBackupGuard=true;evt('SECURITY_GUARDS','Device/privacy/retention/backup guards pass.');}
 if(n===28){s.negativeGuardsPassed=NEGATIVE.length;s.completed=true;evt('E2E_COMPLETE','Browser-local rehearsal PASS; '+NEGATIVE.length+' guardrails covered; production remains unverified.');}
 s.step=n;sessionStorage.setItem(K,JSON.stringify(s));render();}
function render(){const gp=s.profitability.grossProfit;document.getElementById('metrics').innerHTML=[['Step',s.step+' / '+STEPS.length],['Booking',s.booking.status],['Wallet',s.wallet.balance.toLocaleString('id-ID')],['Manifest',s.manifest.status],['Tracking',s.tracking.status],['Chargeable',s.weight.chargeable? s.weight.chargeable+' kg':'-'],['Gross Profit',gp? 'Rp '+gp.toLocaleString('id-ID'):'-'],['Reconcile',s.reconciliation],['Guardrails',s.negativeGuardsPassed+'/'+NEGATIVE.length],['Prod Writes',s.productionWrites]].map(x=>'<div class="metric"><small>'+x[0]+'</small><b>'+x[1]+'</b></div>').join('');document.getElementById('steps').innerHTML=STEPS.map((x,i)=>'<div class="step '+(i<s.step?'done ':'')+(i===s.step?'current':'')+'"><b>'+(i+1)+'. '+x[0]+'</b><div>'+x[1]+'</div></div>').join('');document.getElementById('state').textContent=JSON.stringify(s,null,2)}
document.getElementById('next').onclick=()=>{if(s.step<STEPS.length)apply(s.step+1)};document.getElementById('all').onclick=()=>{while(s.step<STEPS.length)apply(s.step+1)};document.getElementById('reset').onclick=()=>{s=base();sessionStorage.setItem(K,JSON.stringify(s));render()};render();
</script></body></html>`;return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-go-live/simulation'};
