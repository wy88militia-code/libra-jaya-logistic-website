import { validAdminSession } from './_partner-core.mjs';
import { getPod } from './_tracking-core.mjs';

export default async request=>{
  if(!validAdminSession(request))return new Response('Unauthorized',{status:401});
  const podId=new URL(request.url).searchParams.get('id');if(!podId)return new Response('POD ID required',{status:400});
  const pod=await getPod(podId);if(!pod)return new Response('Not found',{status:404});
  return new Response(Buffer.from(pod.base64,'base64'),{headers:{'content-type':pod.contentType||'application/octet-stream','content-disposition':`inline; filename="${String(pod.originalName||'pod').replace(/["\r\n]/g,'')}"`,'cache-control':'private, max-age=300','x-content-type-options':'nosniff'}});
};
export const config={path:'/.netlify/functions/pod-media',method:'GET'};
