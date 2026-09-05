import { screenKarantina } from './_karantina-core.mjs';

const allowedOrigins=new Set(['https://jlexpress.id','https://www.jlexpress.id','https://librajayalogistic.com','https://www.librajayalogistic.com']);
const MAX_BODY_BYTES=8192;
const MAX_COMMODITY_CHARS=800;
const MAX_LOCATION_CHARS=600;

function requestOrigin(request){return String(request.headers.get('origin')||'').trim();}
function originAllowed(request){const origin=requestOrigin(request);return !origin||allowedOrigins.has(origin);}
function headers(request){
  const h={'content-type':'application/json; charset=utf-8','cache-control':'no-store, max-age=0','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','vary':'Origin'};
  const origin=requestOrigin(request);if(origin&&allowedOrigins.has(origin)){h['access-control-allow-origin']=origin;h['access-control-allow-methods']='POST, OPTIONS';h['access-control-allow-headers']='content-type';}
  return h;
}
function json(request,body,status=200){return new Response(JSON.stringify(body),{status,headers:headers(request)});}
function clean(value,max){return String(value??'').trim().slice(0,max);}

export default async request=>{
  if(!originAllowed(request))return json(request,{ok:false,message:'Origin tidak diizinkan.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headers(request)});
  if(request.method!=='POST')return json(request,{ok:false,message:'Metode tidak diizinkan.'},405);
  const contentLength=Number(request.headers.get('content-length')||0);if(Number.isFinite(contentLength)&&contentLength>MAX_BODY_BYTES)return json(request,{ok:false,message:'Payload terlalu besar.'},413);
  let raw='';try{raw=await request.text();}catch{return json(request,{ok:false,message:'Body tidak dapat dibaca.'},400);}if(Buffer.byteLength(raw,'utf8')>MAX_BODY_BYTES)return json(request,{ok:false,message:'Payload terlalu besar.'},413);
  let body;try{body=JSON.parse(raw||'{}');}catch{return json(request,{ok:false,message:'Body JSON tidak valid.'},400);}
  const commodity=clean(body?.commodity||body?.contents||body?.description,MAX_COMMODITY_CHARS);if(!commodity)return json(request,{ok:false,message:'Jenis/isi barang wajib diisi.'},400);
  try{
    const result=await screenKarantina({commodity,cargoType:clean(body?.cargoType,60),condition:clean(body?.condition,300),origin:clean(body?.origin,MAX_LOCATION_CHARS),originHub:clean(body?.originHub,80),destination:clean(body?.destination,MAX_LOCATION_CHARS),destinationHub:clean(body?.destinationHub,80)});
    return json(request,result,200);
  }catch{
    return json(request,{ok:false,status:'SCREENING_UNAVAILABLE',message:'Master Karantina belum dapat dibaca. Lanjutkan ke Admin JL Express untuk verifikasi manual.'},503);
  }
};

export const config={path:'/.netlify/functions/public-karantina-screen',rateLimit:{windowSize:60,windowLimit:30,aggregateBy:'ip',action:'rate_limit'}};
