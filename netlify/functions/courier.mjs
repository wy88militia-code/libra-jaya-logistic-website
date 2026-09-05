import adminCourierHandler from './admin-courier.mjs';
import { getAdminSession } from './_partner-core.mjs';

const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function courierLanding(session){return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Portal Kurir | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:760px;margin:auto}.topin{display:flex;justify-content:space-between;gap:12px}.top a{color:#fff}.wrap{padding:24px 14px}.hero{background:linear-gradient(135deg,#07315a,#0b6aa9);color:#fff;padding:20px;border-radius:18px}.hero h1{margin:0 0 5px}.hero p{margin:0;color:#d7e8f5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.card{background:#fff;border:1px solid #dce5ee;border-radius:16px;padding:17px;text-decoration:none;color:inherit}.card strong{display:block;font-size:18px}.card span{display:block;margin-top:6px;font-size:12px;color:#667b8e;line-height:1.5}.primary{background:#edf7ff;border-color:#bcdcf4}.lastmile{background:#eef9f1;border-color:#bfe1c8}@media(max-width:600px){.grid{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA • PORTAL KURIR</strong><a href="/.netlify/functions/courier-logout">Keluar</a></div></header><main class="wrap"><section class="hero"><h1>Halo, ${esc(session.username)}</h1><p>Pilih alur kerja sesuai tugas yang diberikan OPS.</p></section><section class="grid"><a class="card lastmile" href="/courier/lastmile-djj"><strong>🚚 Last-mile DJJ</strong><span>Hub Sentani/Jayapura → Take Custody → Out for Delivery → GPS + POD.</span></a><a class="card primary" href="/courier/assignments"><strong>📦 Semua Tugas & Custody</strong><span>Pickup, handover, incoming, rute umum dan riwayat custody.</span></a></section></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});}

export default async request=>{
  const session=getAdminSession(request);
  if(!session)return Response.redirect(new URL('/courier-login.html',request.url),302);
  if(!['COURIER','OPS','SUPERADMIN'].includes(session.role))return new Response('Akses Portal Kurir ditolak.',{status:403});
  if(session.role==='COURIER')return courierLanding(session);
  const response=await adminCourierHandler(request);
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=(await response.text())
    .replace('<a href="/admin-tool">← Home Admin</a>','<span><a href="/courier/lastmile-djj" style="margin-right:14px">Last-mile DJJ</a><a href="/courier/assignments" style="margin-right:14px">Tugas & Custody</a><a href="/courier/simulation" style="margin-right:14px">Simulasi</a><a href="/.netlify/functions/courier-logout">Keluar</a></span>')
    .replace('<title>Admin Kurir | Libra</title>','<title>Portal Kurir | Libra</title>')
    .replace('LIBRA JAYA LOGISTIC • Courier Backend','LIBRA JAYA LOGISTIC • Portal Kurir');
  const headers=new Headers(response.headers);headers.set('content-length',String(Buffer.byteLength(html)));
  return new Response(html,{status:response.status,headers});
};
export const config={path:'/courier'};
