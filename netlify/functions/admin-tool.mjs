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

export default request=>{
  const token=readCookie(request,COOKIE_NAME);
  if(!validSession(token,process.env.ADMIN_SESSION_SECRET)){
    return Response.redirect(new URL('/admin-login.html',request.url),302);
  }
  return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Admin Tool</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;font-family:system-ui;background:#061d36;color:#10243d}.card{width:min(100%,440px);padding:34px;border-radius:22px;background:#fff;text-align:center}.btn{display:block;margin-top:14px;padding:16px;border-radius:12px;background:#ef312b;color:#fff;text-decoration:none;font-weight:800}.secondary{background:#0b2d52}</style></head><body><main class="card"><h1>Admin Tool</h1><p>Sesi terverifikasi. Pilih panel yang ingin dibuka.</p><a class="btn" href="https://www.jlexpress.id/admin" target="_blank" rel="noopener">Buka Admin JL Express</a><a class="btn secondary" href="/.netlify/functions/admin-logout">Keluar</a></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
};

export const config={path:'/admin-tool'};
