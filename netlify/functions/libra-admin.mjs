import adminTool from './admin-tool.mjs';
import { getAdminSession } from './_partner-core.mjs';

export default async request=>{
  const session=getAdminSession(request);
  const response=await adminTool(request);
  if(String(session?.role||'').toUpperCase()!=='SUPERADMIN')return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=await response.text();
  const quick=`<a href="/jlx-soetta" style="display:flex;justify-content:space-between;align-items:center;gap:16px;text-decoration:none;background:#eaf4ff;border:1px solid #bed9f0;color:#0b3659;padding:16px 18px;border-radius:15px;margin:0 0 18px"><div><b style="display:block;font-size:18px">✈ JL Express Soetta</b><span style="display:block;margin-top:4px;font-size:12px;color:#58738a">Cek pesanan, pickup, gudang transit, timbang, faktur, SMU dan PTI.</span></div><strong style="white-space:nowrap">Buka Operasional →</strong></a>`;
  const injected=html.replace('<section class="grid">',`${quick}<section class="grid">`);
  const headers=new Headers(response.headers);headers.set('content-length',String(Buffer.byteLength(injected)));
  return new Response(injected,{status:response.status,headers});
};

export const config={path:'/libra-admin'};
