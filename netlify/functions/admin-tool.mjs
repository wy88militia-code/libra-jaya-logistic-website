import { listAccurateJobs } from './_accurate-core.mjs';
import { canRoleAccessPath } from './_admin-rbac-core.mjs';
import { billingAgingSummary } from './_billing-core.mjs';
import { listBookings } from './_booking-core.mjs';
import { countPendingApprovals } from './_maker-checker-core.mjs';
import { getLastMasterSync } from './_master-sheet-core.mjs';
import { countUnreadAdminNotifications } from './_notification-core.mjs';
import { getAdminSession } from './_partner-core.mjs';
import { listQuotes } from './_quote-core.mjs';
import { getSlaSummary } from './_sla-monitor-core.mjs';
import { ticketSummary } from './_ticket-core.mjs';
import { listIncidentEvents } from './_tracking-core.mjs';

const cards=[
 ['Go-Live Readiness','Kontrol final sebelum transaksi nyata: master/rate/vendor, Xendit, backup, alert dan privacy. Accurate tetap ditandai terpisah sampai siap.','/admin-go-live','Buka Go-Live'],
 ['Partner & Deposit','Daftar partner, saldo deposit dan koreksi saldo maker-checker. Top-up Xendit masuk otomatis melalui webhook.','/admin-partners','Buka Partner'],
 ['Approval Center','Maker-checker untuk tindakan sensitif seperti koreksi saldo, override rate dan recovery.','/admin-approvals','Buka Approval'],
 ['Finance & Billing','Statement partner, debit/credit note, settlement klaim dan aging. Accurate masih dipisahkan.','/admin-finance-billing','Buka Finance'],
 ['Accurate Online Bridge','Belum diotomatisasi. Dipertahankan sebagai panel manual/test sampai koneksi Accurate benar-benar siap.','/admin-accurate','Buka Accurate'],
 ['Link Partner','Link Manual Booking, aktivasi partner dan onboarding integrasi API.','/admin-partner-links','Buka Link Partner'],
 ['Rate Plan Partner','Override harga khusus partner. Jika tidak ada override, Quote otomatis memakai Tarif Rekom dari Modal Rute Pilot.','/admin-rate-plans','Buka Rate Plan'],
 ['Master Rute, SLA & Harga','Auto-sync Google Sheet setiap 5 menit. Maps, SLA dan Modal Pilot langsung menjadi sumber Quote, Booking dan API.','/admin-master-sheet','Buka Master'],
 ['Google Maps & Geocoding','Generate dan validasi 41 tujuan pilot. Hasil Maps otomatis masuk Master pada siklus sync berikutnya.','/admin-maps-pilot','Buka Maps Pilot'],
 ['Vendor Master & Cost','Master vendor, rate vendor dan surcharge untuk expected cost operasional.','/admin-vendor-master','Buka Vendor'],
 ['Profitability','Bandingkan revenue booking dengan expected/actual vendor cost dan margin per kiriman.','/admin-profitability','Buka Profitability'],
 ['Courier Assignment','Assign kurir/pickup dan chain-of-custody sebelum barang bergerak.','/admin-courier-assignment','Buka Assignment'],
 ['Manifest','Kelompokkan booking menjadi manifest operasional per keberangkatan/rute.','/admin-manifests','Buka Manifest'],
 ['Warehouse / Hub Scan','Scan masuk-keluar hub dan kontrol custody gudang.','/admin-warehouse','Buka Warehouse'],
 ['Actual Weight & Reweigh','Catat timbang ulang/chargeable weight sebelum billing final.','/admin-weights','Buka Weight'],
 ['SLA Command Center','Monitor HIJAU/KUNING/MERAH, connecting flight dan stale tracking otomatis.','/admin-sla-control','Buka SLA Monitor'],
 ['Customer Service Tickets','Antrean keluhan partner, SLA response/resolution, PIC, balasan partner dan catatan internal.','/admin-tickets','Buka Ticket Desk'],
 ['Quote & Booking','Quote otomatis memakai Master + harga rekomendasi; manual approval hanya bila rute/harga memang perlu review.','/admin-quotes','Buka Quote'],
 ['Booking & Pickup','Booking resmi, GPS tujuan dan antrean pickup.','/admin-bookings','Buka Booking'],
 ['Rekonsiliasi Partner','History booking, debit wallet, POD, klaim dan pencocokan ledger.','/admin-reconciliation','Buka Rekonsiliasi'],
 ['Notification & Webhook','Notifikasi operasional, retry dan replay webhook.','/admin-webhook-control','Buka Control Center'],
 ['API Onboarding','Pendaftaran partner API, screening dan proses aktivasi.','/admin-api-onboarding','Buka Onboarding'],
 ['API UAT','Uji integrasi partner sebelum Production API dibuka.','/admin-api-uat','Buka UAT'],
 ['API Partner','API key, HMAC signature, serviceability, endpoint dan log integrasi.','/admin-api-partners','Buka API'],
 ['API Security & Health','Emergency suspend, IP allowlist, quota, anomaly dan health Production API.','/admin-api-security','Buka Security'],
 ['Tracking & POD','Kurir update status, GPS, foto penerima dan POD; SLA monitor ikut diperbarui.','/admin-courier','Buka Tracking'],
 ['Klaim & Insiden','Barang tertahan/rusak dan klaim ke logistik pengirim.','/admin-claims','Buka Klaim'],
 ['Audit, Backup & DR','Audit tamper-evident, backup, retention dan disaster recovery maker-checker.','/admin-audit-backup','Buka Audit & Backup'],
 ['Privacy & Device Security','Device-bound admin/courier session, pseudonymous logging dan retention guard.','/admin-privacy-security','Buka Privacy'],
 ['Resilience & Alerts','Off-site encrypted backup serta email/WhatsApp alert.','/admin-resilience','Buka Resilience'],
];
function esc(v){return String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));}
function card([title,desc,href,label]){return `<article class="tile"><span class="dot"></span><h2>${title}</h2><p>${desc}</p><a href="${href}">${label}</a></article>`;}
export default async request=>{
 const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);
 let pendingQuotes=0,waitingPickup=0,incidents=0,unreadNotifications=0,slaRed=0,slaYellow=0,pendingApprovals=0,billingOutstanding=0,accurateNeedsMapping=0,ticketOpen=0,ticketRed=0,masterStale=false,masterAgeMin=null;
 try{if(canRoleAccessPath(session.role,'/admin-quotes')){const quotes=await listQuotes(200);pendingQuotes=quotes.filter(q=>q.status==='PENDING_APPROVAL').length;}}catch{}
 try{if(canRoleAccessPath(session.role,'/admin-master-sheet')){const sync=await getLastMasterSync();if(sync?.syncedAt){masterAgeMin=Math.round((Date.now()-new Date(sync.syncedAt).getTime())/60000);masterStale=masterAgeMin>15;}else masterStale=true;}}catch{masterStale=true;}
 try{if(canRoleAccessPath(session.role,'/admin-bookings')){const bookings=await listBookings(250);waitingPickup=bookings.filter(b=>['BOOKED','PICKUP_ASSIGNED'].includes(b.status)).length;}}catch{}
 try{if(canRoleAccessPath(session.role,'/admin-claims'))incidents=(await listIncidentEvents(100)).length;}catch{}
 try{if(canRoleAccessPath(session.role,'/admin-webhook-control'))unreadNotifications=await countUnreadAdminNotifications();}catch{}
 try{if(canRoleAccessPath(session.role,'/admin-sla-control')){const sla=await getSlaSummary();slaRed=sla.red;slaYellow=sla.yellow;}}catch{}
 try{if(canRoleAccessPath(session.role,'/admin-tickets')){const tickets=await ticketSummary();ticketOpen=tickets.open;ticketRed=tickets.red;}}catch{}
 try{if(canRoleAccessPath(session.role,'/admin-approvals'))pendingApprovals=await countPendingApprovals();}catch{}
 try{if(canRoleAccessPath(session.role,'/admin-finance-billing'))billingOutstanding=(await billingAgingSummary()).outstanding;}catch{}
 try{if(canRoleAccessPath(session.role,'/admin-accurate'))accurateNeedsMapping=(await listAccurateJobs(200)).filter(j=>j.status==='NEEDS_MAPPING').length;}catch{}
 const alertItems=[
  masterStale&&canRoleAccessPath(session.role,'/admin-master-sheet')?`<a href="/admin-master-sheet"><b>!</b><span>Master auto-sync ${masterAgeMin===null?'belum pernah berhasil':`terakhir ${masterAgeMin} menit lalu`}</span></a>`:'',
  ticketRed&&canRoleAccessPath(session.role,'/admin-tickets')?`<a href="/admin-tickets?risk=RED"><b>${ticketRed}</b><span>Ticket Customer Service SLA MERAH</span></a>`:'',
  ticketOpen&&canRoleAccessPath(session.role,'/admin-tickets')?`<a href="/admin-tickets"><b>${ticketOpen}</b><span>Ticket Customer Service aktif</span></a>`:'',
  pendingApprovals&&canRoleAccessPath(session.role,'/admin-approvals')?`<a href="/admin-approvals"><b>${pendingApprovals}</b><span>Approval sensitif menunggu keputusan</span></a>`:'',
  billingOutstanding&&canRoleAccessPath(session.role,'/admin-finance-billing')?`<a href="/admin-finance-billing"><b>Rp</b><span>Outstanding billing ${Number(billingOutstanding).toLocaleString('id-ID')}</span></a>`:'',
  accurateNeedsMapping&&canRoleAccessPath(session.role,'/admin-accurate')?`<a href="/admin-accurate"><b>${accurateNeedsMapping}</b><span>Accurate masih manual / perlu mapping</span></a>`:'',
  slaRed?`<a href="/admin-sla-control?risk=RED"><b>${slaRed}</b><span>Kiriman SLA MERAH perlu eskalasi</span></a>`:'',slaYellow?`<a href="/admin-sla-control?risk=YELLOW"><b>${slaYellow}</b><span>Kiriman SLA KUNING perlu dipantau</span></a>`:'',unreadNotifications?`<a href="/admin-webhook-control"><b>${unreadNotifications}</b><span>Notifikasi operasional belum dibaca</span></a>`:'',pendingQuotes?`<a href="/admin-quotes"><b>${pendingQuotes}</b><span>Quote memang memerlukan review manual</span></a>`:'',waitingPickup?`<a href="/admin-courier"><b>${waitingPickup}</b><span>Booking menunggu pickup/proses</span></a>`:'',incidents?`<a href="/admin-claims"><b>${incidents}</b><span>Insiden/klaim perlu perhatian</span></a>`:''];
 const alerts=alertItems.filter(Boolean).join(''),visibleCards=cards.filter(([, ,href])=>canRoleAccessPath(session.role,href));
 return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Admin Libra Logistics</title><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:#f2f6fa;color:#10243d}.top{background:#061d36;color:#fff;padding:22px 26px}.top-inner{max-width:1180px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand strong{display:block;font-size:21px}.brand span{display:block;color:#b9cce0;margin-top:4px}.user{display:flex;align-items:center;gap:10px}.user span{font-size:12px;color:#c6d8e8;text-align:right}.top a{color:#fff;text-decoration:none;border:1px solid #54718c;padding:9px 14px;border-radius:9px}.wrap{max-width:1180px;margin:0 auto;padding:28px 22px 50px}.hero{background:linear-gradient(135deg,#0b2d52,#0b426e);color:#fff;padding:28px;border-radius:22px;display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:18px}.hero h1{margin:0 0 9px;font-size:32px}.hero p{margin:0;max-width:760px;color:#d7e6f3;line-height:1.55}.tag{background:#ffffff19;border:1px solid #ffffff36;padding:10px 14px;border-radius:999px;white-space:nowrap}.attention{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 22px}.attention a{display:flex;align-items:center;gap:12px;background:#fff7df;border:1px solid #ecd486;color:#5f4b11;text-decoration:none;padding:13px 16px;border-radius:13px}.attention b{font-size:21px;color:#d45b20}.attention span{font-weight:750;font-size:13px}.empty-attention{background:#e9f6ee;color:#176b37;border:1px solid #cce8d6;padding:13px 16px;border-radius:13px;margin-bottom:22px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.tile{background:#fff;border:1px solid #dce6ef;border-radius:18px;padding:20px;min-height:210px;display:flex;flex-direction:column;box-shadow:0 8px 25px #0b2d5209}.tile .dot{width:12px;height:12px;background:#ef312b;border-radius:50%;margin-bottom:18px}.tile h2{font-size:18px;margin:0 0 8px}.tile p{font-size:14px;line-height:1.5;color:#5b6e82;margin:0 0 18px}.tile a{margin-top:auto;text-decoration:none;background:#0b2d52;color:#fff;padding:11px 13px;border-radius:10px;text-align:center;font-weight:800}.foot{margin-top:22px;display:flex;gap:12px;flex-wrap:wrap}.foot a{color:#0b2d52;font-weight:700}@media(max-width:1000px){.grid,.attention{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid,.attention{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}.hero h1{font-size:26px}.top-inner{align-items:flex-start}.user{flex-direction:column;align-items:flex-end}}</style></head><body><header class="top"><div class="top-inner"><div class="brand"><strong>LIBRA JAYA LOGISTIC</strong><span>Admin Backend • Papua Logistics Gateway</span></div><div class="user"><span>${esc(session.username)}<br>${esc(session.role)}</span><a href="/.netlify/functions/admin-logout">Keluar</a></div></div></header><main class="wrap"><section class="hero"><div><h1>Home Admin</h1><p>Alur operasional sudah dibuat otomatis dari Master → harga → quote → booking → pickup/hub → tracking/SLA → billing/rekonsiliasi. Accurate tetap dipisahkan sampai koneksinya siap.</p></div><div class="tag">${esc(session.role)} • AUTO FLOW</div></section>${alerts?`<section class="attention">${alerts}</section>`:'<div class="empty-attention">Semua koneksi operasional yang terpantau dalam kondisi normal.</div>'}<section class="grid">${visibleCards.map(card).join('')}</section><div class="foot">${canRoleAccessPath(session.role,'/admin-partner-links')?'<a href="/admin-partner-links">Link Partner ↗</a>':''}<a href="https://www.jlexpress.id/admin" target="_blank" rel="noopener">Admin JL Express ↗</a></div></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-tool'};
