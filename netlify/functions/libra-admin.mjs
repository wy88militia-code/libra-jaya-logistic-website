import adminTool from './admin-tool.mjs';
import { getAdminSession } from './_partner-core.mjs';

export default async request=>{
  const session=getAdminSession(request);
  const response=await adminTool(request);
  if(String(session?.role||'').toUpperCase()!=='SUPERADMIN')return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=await response.text();
  const quick=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin:0 0 18px"><a href="/jlx-soetta" style="display:flex;justify-content:space-between;align-items:center;gap:16px;text-decoration:none;background:#eaf4ff;border:1px solid #bed9f0;color:#0b3659;padding:16px 18px;border-radius:15px"><div><b style="display:block;font-size:18px">✈ JL Express Soetta</b><span style="display:block;margin-top:4px;font-size:12px;color:#58738a">Booking, marketplace, gudang transit, timbang, SMU dan flight CGK-DJJ.</span></div><strong style="white-space:nowrap">Buka →</strong></a><a href="/admin-lastmile-djj" style="display:flex;justify-content:space-between;align-items:center;gap:16px;text-decoration:none;background:#eef9f1;border:1px solid #bfe1c8;color:#164d2b;padding:16px 18px;border-radius:15px"><div><b style="display:block;font-size:18px">🚚 Last-mile DJJ</b><span style="display:block;margin-top:4px;font-size:12px;color:#557461">Satu antrean Hub Sentani untuk JL Express PTD + Partner API last-mile sampai POD.</span></div><strong style="white-space:nowrap">Buka →</strong></a></div>`;
  const injected=html.replace('<section class="grid">',`${quick}<section class="grid">`);
  const headers=new Headers(response.headers);headers.set('content-length',String(Buffer.byteLength(injected)));
  return new Response(injected,{status:response.status,headers});
};

export const config={path:'/libra-admin'};
