import { screenKarantina } from './_karantina-core.mjs';

const allowedOrigins=new Set(['https://jlexpress.id','https://www.jlexpress.id','https://librajayalogistic.com','https://www.librajayalogistic.com']);
function cors(request){const origin=String(request.headers.get('origin')||'');return origin&&allowedOrigins.has(origin)?origin:'https://jlexpress.id';}
function headers(request){return {'content-type':'application/json; charset=utf-8','cache-control':'no-store, max-age=0','access-control-allow-origin':cors(request),'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type','vary':'Origin','x-content-type-options':'nosniff'};}

export default async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headers(request)});
  if(request.method!=='POST')return Response.json({ok:false,message:'Metode tidak diizinkan.'},{status:405,headers:headers(request)});
  let body;try{body=await request.json();}catch{return Response.json({ok:false,message:'Body JSON tidak valid.'},{status:400,headers:headers(request)});}
  const commodity=String(body?.commodity||body?.contents||body?.description||'').trim();if(!commodity)return Response.json({ok:false,message:'Jenis/isi barang wajib diisi.'},{status:400,headers:headers(request)});
  try{
    const result=await screenKarantina({commodity,cargoType:body?.cargoType,condition:body?.condition,origin:body?.origin,originHub:body?.originHub,destination:body?.destination,destinationHub:body?.destinationHub});
    return new Response(JSON.stringify(result),{status:200,headers:headers(request)});
  }catch(error){return new Response(JSON.stringify({ok:false,status:'SCREENING_UNAVAILABLE',message:'Master Karantina belum dapat dibaca. Lanjutkan ke Admin JL Express untuk verifikasi manual.',detail:String(error?.message||error).slice(0,240)}),{status:503,headers:headers(request)});}
};

export const config={path:'/.netlify/functions/public-karantina-screen',rateLimit:{windowSize:60,windowLimit:60,aggregateBy:'ip',action:'rate_limit'}};
