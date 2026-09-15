import type { Config } from '@netlify/functions';
import { probeAccurateCustomerByName } from './_accurate-sales-order-core.mjs';

const clean=(v:unknown,n=500)=>String(v??'').trim().slice(0,n);
function authorized(req:Request){const expected=clean(Netlify.env.get('LIBRA_HC_BRIDGE_SECRET'),500);const got=clean(req.headers.get('x-libra-hc-secret'),500);return Boolean(expected&&got&&expected===got);}

export default async(req:Request)=>{
 if(req.method!=='POST')return new Response('Method Not Allowed',{status:405});
 if(!authorized(req))return new Response('Not Found',{status:404});
 try{
  const body:any=await req.json();
  const action=clean(body?.action,40).toLowerCase();
  if(action==='probe_customer'){
    const result=await probeAccurateCustomerByName(clean(body?.customerName,240));
    return Response.json({ok:true,action,result},{headers:{'cache-control':'no-store'}});
  }
  return Response.json({ok:false,error:'Aksi bridge belum diizinkan.'},{status:400,headers:{'cache-control':'no-store'}});
 }catch(e:any){return Response.json({ok:false,error:clean(e?.message||e,800)},{status:500,headers:{'cache-control':'no-store'}});}
};
export const config:Config={path:'/api/hc-accurate-bridge'};
