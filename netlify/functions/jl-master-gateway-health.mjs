export default async request=>{
  const configured=Boolean(String(process.env.JL_SSOT_GATEWAY_TOKEN||'').trim());
  if(!configured)return Response.json({configured:false,status:'TOKEN_MISSING'},{headers:{'cache-control':'no-store'}});
  const url=new URL('/.netlify/functions/jl-master-gateway',request.url);
  try{
    const r=await fetch(url,{headers:{authorization:'Bearer '+String(process.env.JL_SSOT_GATEWAY_TOKEN||'')}});
    const j=await r.json().catch(()=>({}));
    return Response.json({configured:true,httpStatus:r.status,ok:r.ok,source:j?.source||'',sheetIdPresent:Boolean(j?.sheetId),configRows:Array.isArray(j?.ranges?.config)?j.ranges.config.length:0},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({configured:true,ok:false,status:'FETCH_ERROR',message:String(error?.message||error)},{status:502,headers:{'cache-control':'no-store'}});}
};
export const config={path:'/.netlify/functions/jl-master-gateway-health',method:'GET'};
