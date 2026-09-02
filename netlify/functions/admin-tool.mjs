import crypto from 'node:crypto';

const COOKIE_NAME='libra_admin_session';

function sign(value,secret){
  return crypto.createHmac('sha256',secret).update(value).digest('base64url');
}

function readCookie(request,name){
  const value=request.headers.get('cookie')||'';
  const match=value.split(';').map(item=>item.trim()).find(item=>item.startsWith(`${name}=`));
  return match?match.slice(name.length+1):'';
}

function validSession(token,secret){
  if(!token||!secret)return false;
  const [payload,signature]=token.split('.');
  if(!payload||!signature)return false;
  const expected=sign(payload,secret);
  const a=Buffer.from(signature);const b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return false;
  try{return JSON.parse(Buffer.from(payload,'base64url').toString()).expires>Math.floor(Date.now()/1000);}catch{return false;}
}

const cards=[
  ['Partner & Deposit','Daftar partner, PIN, API credential, saldo dan mutasi.','/admin-partners','Buka Partner'],
  ['Master Rute & SLA','Sinkronisasi Master Google Sheet ke backend untuk booking dan API.','/admin-master-sheet','Buka Master'],
  ['Booking & Pickup','Kontrol booking portal/API, validasi saldo, pickup dan assignment kurir.','#','Segera'],
  ['Tracking & POD','Update status, foto penerima, keterangan tertahan/rusak dan POD.','#','Segera'],
  ['Klaim & Insiden','Catat kerusakan, kehilangan, dokumen klaim dan status penyelesaian.','#','Segera'],
  ['API Partner','API key partner, status koneksi, webhook dan log order.','#','Segera'],
  ['Xendit & Wallet','Top-up deposit, rekonsiliasi pembayaran dan audit saldo.','/admin-partners','Buka Wallet'],
  ['Maps & SLA','Jarak, akses darat, minimum load, charter dan SLA per zona.','/admin-master-sheet','Buka Rute'],
];

function renderCard([title,desc,href,label]){
  const disabled=href==='#';
  return `<article class="tile"><span class="dot"></span><h2>${title}</h2><p>${desc}</p><a class="${disabled?'disabled':''}" ${disabled?'aria-disabled="true"':`href="${href}"`}>${label}</a></article>`;
}

export default request=>{
  const token=readCookie(request,COOKIE_NAME);
  if(!validSession(token,process.env.ADMIN_SESSION_SECRET)){
    return Response.redirect(new URL('/admin-login.html',request.url),302);
  }
  return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Admin Libra Logistics</title><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:#f2f6fa;color:#10243d}.top{background:#061d36;color:#fff;padding:22px 26px}.top-inner{max-width:1180px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand strong{display:block;font-size:21px}.brand span{display:block;color:#b9cce0;margin-top:4px}.top a{color:#fff;text-decoration:none;border:1px solid #54718c;padding:9px 14px;border-radius:9px}.wrap{max-width:1180px;margin:0 auto;padding:28px 22px 50px}.hero{background:linear-gradient(135deg,#0b2d52,#0b426e);color:#fff;padding:28px;border-radius:22px;display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:24px}.hero h1{margin:0 0 9px;font-size:32px}.hero p{margin:0;max-width:700px;color:#d7e6f3;line-height:1.55}.tag{background:#ffffff19;border:1px solid #ffffff36;padding:10px 14px;border-radius:999px;white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.tile{background:#fff;border:1px solid #dce6ef;border-radius:18px;padding:20px;min-height:210px;display:flex;flex-direction:column;box-shadow:0 8px 25px #0b2d5209}.tile .dot{width:12px;height:12px;background:#ef312b;border-radius:50%;margin-bottom:18px}.tile h2{font-size:18px;margin:0 0 8px}.tile p{font-size:14px;line-height:1.5;color:#5b6e82;margin:0 0 18px}.tile a{margin-top:auto;text-decoration:none;background:#0b2d52;color:#fff;padding:11px 13px;border-radius:10px;text-align:center;font-weight:800}.tile a.disabled{background:#d6dee6;color:#738395;pointer-events:none}.foot{margin-top:22px;display:flex;gap:12px;flex-wrap:wrap}.foot a{color:#0b2d52;font-weight:700}@media(max-width:950px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}.hero h1{font-size:26px}.top-inner{align-items:flex-start}.grid{gap:12px}}</style></head><body><header class="top"><div class="top-inner"><div class="brand"><strong>LIBRA JAYA LOGISTIC</strong><span>Admin Backend • Papua Logistics Gateway</span></div><a href="/.netlify/functions/admin-logout">Keluar</a></div></header><main class="wrap"><section class="hero"><div><h1>Home Admin</h1><p>Kontrol partner, saldo deposit, master rute, SLA, booking, tracking, klaim dan integrasi API dari satu backend.</p></div><div class="tag">Master Sheet → Backend → Partner API</div></section><section class="grid">${cards.map(renderCard).join('')}</section><div class="foot"><a href="https://docs.google.com/spreadsheets/d/1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k/edit" target="_blank" rel="noopener">Buka Master Google Sheet ↗</a><a href="https://www.jlexpress.id/admin" target="_blank" rel="noopener">Admin JL Express ↗</a></div></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
};

export const config={path:'/admin-tool'};
