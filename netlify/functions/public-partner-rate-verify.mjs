import { issueRateAccess, submitRateApplicant } from './_partner-rate-access-core.mjs';

function sameOrigin(request){const u=new URL(request.url),origin=request.headers.get('origin'),ref=request.headers.get('referer');if(origin)return origin===u.origin;if(ref){try{return new URL(ref).origin===u.origin;}catch{return false;}}return false;}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function statusPage({title,message,tone='info',detail=''}){return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>body{margin:0;background:#f3f6f9;color:#10243d;font-family:Inter,system-ui,sans-serif}.box{max-width:620px;margin:55px auto;background:#fff;border:1px solid #dbe5ee;border-radius:20px;padding:24px}.pill{display:inline-block;padding:6px 9px;border-radius:999px;font-size:11px;font-weight:900;background:${tone==='bad'?'#ffe8e5':tone==='warn'?'#fff4cf':'#e7f6ed'};color:${tone==='bad'?'#a52d25':tone==='warn'?'#805c08':'#176b37'}}h1{margin:12px 0 8px}p{line-height:1.55;color:#5c7184}.detail{padding:12px;border-radius:11px;background:#f7fafc;font-size:12px;color:#64788a}.btn{display:inline-block;margin-top:14px;background:#0b426e;color:#fff;padding:11px 14px;border-radius:10px;text-decoration:none;font-weight:800}</style></head><body><main class="box"><span class="pill">${tone==='bad'?'TIDAK TERVERIFIKASI':tone==='warn'?'PERLU REVIEW':'TERVERIFIKASI'}</span><h1>${esc(title)}</h1><p>${esc(message)}</p>${detail?`<div class="detail">${esc(detail)}</div>`:''}<a class="btn" href="/harga-partner">Kembali</a></main></body></html>`;}

export default async request=>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 if(!sameOrigin(request))return new Response('Forbidden',{status:403});
 try{
  const form=await request.formData();
  const record=await submitRateApplicant({companyName:form.get('companyName'),nib:form.get('nib'),picName:form.get('picName'),phone:form.get('phone'),consent:form.get('consent')});
  if(record.status==='VERIFIED'){
   const token=issueRateAccess(record,{hours:24});
   const headers=new Headers({'cache-control':'no-store','location':'/harga-partner'});headers.append('set-cookie',`libra_rate_access=${token}; Max-Age=86400; Path=/harga-partner; HttpOnly; Secure; SameSite=Lax`);
   return new Response(null,{status:303,headers});
  }
  if(record.status==='REJECTED')return new Response(statusPage({title:'Data perusahaan belum memenuhi akses harga partner',message:'Verifikasi web menemukan ketidaksesuaian material pada NIB/nama perusahaan atau bidang usaha. Data sudah dicatat agar admin dapat meninjau bila diperlukan.',tone:'bad',detail:record.verification?.reason}),{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY'}});
  return new Response(statusPage({title:'Permintaan sedang diperiksa',message:'Bukti resmi di web belum cukup untuk verifikasi otomatis. Permintaan tidak ditolak; data masuk ke admin Libra untuk review.',tone:'warn',detail:record.verification?.reason}),{status:202,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY'}});
 }catch(error){return new Response(statusPage({title:'Data belum dapat diproses',message:String(error?.message||'Periksa data yang diisi lalu coba lagi.'),tone:'bad'}),{status:400,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY'}});}
};

export const config={path:'/.netlify/functions/public-partner-rate-verify',method:'POST',rateLimit:{windowSize:900,windowLimit:5,aggregateBy:'ip',action:'rate_limit'}};
