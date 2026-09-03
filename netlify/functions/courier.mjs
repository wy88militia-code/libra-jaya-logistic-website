import adminCourierHandler from './admin-courier.mjs';
import { getAdminSession } from './_partner-core.mjs';

export default async request=>{
  const session=getAdminSession(request);
  if(!session)return Response.redirect(new URL('/courier-login.html',request.url),302);
  if(!['COURIER','OPS','SUPERADMIN'].includes(session.role))return new Response('Akses Portal Kurir ditolak.',{status:403});
  const response=await adminCourierHandler(request);
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const html=(await response.text())
    .replace('<a href="/admin-tool">← Home Admin</a>','<span><a href="/courier/assignments" style="margin-right:14px">Tugas & Custody</a><a href="/courier/simulation" style="margin-right:14px">Simulasi</a><a href="/.netlify/functions/courier-logout">Keluar</a></span>')
    .replace('<title>Admin Kurir | Libra</title>','<title>Portal Kurir | Libra</title>')
    .replace('LIBRA JAYA LOGISTIC • Courier Backend','LIBRA JAYA LOGISTIC • Portal Kurir');
  const headers=new Headers(response.headers);headers.set('content-length',String(Buffer.byteLength(html)));
  return new Response(html,{status:response.status,headers});
};
export const config={path:'/courier'};
