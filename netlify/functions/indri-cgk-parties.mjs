import crypto from 'node:crypto';
import {db,clean,json,assertIndriSession} from './_indri-cgk-core.mjs';
const TYPES=new Set(['SHIPPER','CONSIGNEE']);const key=(type,id)=>`party/${type}/${id}`;
async function list(type){const {blobs}=await db().list({prefix:`party/${type}/`});const rows=(await Promise.all(blobs.map(x=>db().get(x.key,{type:'json',consistency:'strong'})))).filter(Boolean);return rows.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'id'));}
function normalize(b,existing={}){const type=clean(b.type,20).toUpperCase();return {...existing,id:existing.id||crypto.randomUUID(),type,code:clean(b.code,40).toUpperCase(),name:clean(b.name,140),company:clean(b.company,160),pic:clean(b.pic,120),phone:clean(b.phone,40),email:clean(b.email,140),province:clean(b.province,100),city:clean(b.city,100),district:clean(b.district,100),village:clean(b.village,100),postalCode:clean(b.postalCode,20),address:clean(b.address,800),airport:clean(b.airport,10).toUpperCase(),notes:clean(b.notes,1000),active:b.active!==false,updatedAt:new Date().toISOString(),createdAt:existing.createdAt||new Date().toISOString()};}
export default async request=>{
  try{assertIndriSession(request);}catch(e){return json({message:e.message},e.status||401);}
  const url=new URL(request.url),method=request.method;
  if(method==='GET'){const type=clean(url.searchParams.get('type'),20).toUpperCase();if(type&&!TYPES.has(type))return json({message:'Tipe master tidak valid.'},400);if(type)return json({items:await list(type)});const [shippers,consignees]=await Promise.all([list('SHIPPER'),list('CONSIGNEE')]);return json({shippers,consignees});}
  if(method==='POST'||method==='PUT'){let b;try{b=await request.json();}catch{return json({message:'Data tidak valid.'},400);}const type=clean(b.type,20).toUpperCase();if(!TYPES.has(type))return json({message:'Pilih MASTER PENGIRIM atau MASTER KONSINYI.'},400);let existing={};if(method==='PUT'){const id=clean(b.id,80);existing=await db().get(key(type,id),{type:'json',consistency:'strong'});if(!existing)return json({message:'Data master tidak ditemukan.'},404);}const item=normalize(b,existing);if(!item.name||!item.phone||!item.address)return json({message:'Nama, nomor HP, dan alamat wajib diisi.'},400);if(!item.code)item.code=(type==='SHIPPER'?'SHP':'CON')+'-'+String(Date.now()).slice(-6);await db().setJSON(key(type,item.id),item);return json({ok:true,item},method==='POST'?201:200);}
  return json({message:'Metode tidak diizinkan.'},405);
};
export const config={path:'/.netlify/functions/indri-cgk-parties',method:['GET','POST','PUT']};
