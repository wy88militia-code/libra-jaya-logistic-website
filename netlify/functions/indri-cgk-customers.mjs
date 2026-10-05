import crypto from 'node:crypto';
import {db,clean,num,json,assertIndriSession} from './_indri-cgk-core.mjs';
const SCHEMES=new Set(['CASH','DP','CREDIT']);
const PKS_STATUSES=new Set(['DRAFT','REVIEW','READY_FOR_PRIVY','ACTIVE','SUSPENDED','EXPIRED']);
const key=id=>`customer/${id}`;
async function list(){const {blobs}=await db().list({prefix:'customer/'});const rows=(await Promise.all(blobs.map(x=>db().get(x.key,{type:'json',consistency:'strong'})))).filter(Boolean);return rows.sort((a,b)=>String(a.legalName||'').localeCompare(String(b.legalName||''),'id'));}
function normalize(b,existing={}){
  const paymentScheme=clean(b.paymentScheme,20).toUpperCase();
  return {...existing,id:existing.id||crypto.randomUUID(),customerCode:clean(b.customerCode,40).toUpperCase(),legalName:clean(b.legalName,180),tradeName:clean(b.tradeName,160),nib:clean(b.nib,60),npwp:clean(b.npwp,60),pic:clean(b.pic,140),phone:clean(b.phone,40),email:clean(b.email,140),address:clean(b.address,900),signatoryName:clean(b.signatoryName,140),signatoryTitle:clean(b.signatoryTitle,120),pksWith:'PT LIBRA JAYA LOGISTIK',pksNumber:clean(b.pksNumber,120),pksDate:clean(b.pksDate,20),pksValidUntil:clean(b.pksValidUntil,20),pksStatus:PKS_STATUSES.has(existing.pksStatus)?existing.pksStatus:'DRAFT',paymentScheme:SCHEMES.has(paymentScheme)?paymentScheme:'CASH',dpPercent:Math.max(0,Math.min(100,num(b.dpPercent))),creditLimit:Math.max(0,num(b.creditLimit)),creditDays:Math.max(0,Math.min(365,Math.floor(num(b.creditDays)))),active:b.active!==false,notes:clean(b.notes,1400),updatedAt:new Date().toISOString(),createdAt:existing.createdAt||new Date().toISOString()};
}
function validate(x){
  if(!x.legalName||!x.pic||!x.phone||!x.address)return 'Nama PT/Pengirim, PIC, nomor HP, dan alamat wajib diisi.';
  if(['REVIEW','READY_FOR_PRIVY','ACTIVE'].includes(x.pksStatus)&&(!x.signatoryName||!x.signatoryTitle))return 'Nama dan jabatan penandatangan PKS wajib diisi.';
  if(x.paymentScheme==='DP'&&(x.dpPercent<=0||x.dpPercent>=100))return 'Skema DP membutuhkan persentase DP antara 1% sampai 99%.';
  if(x.paymentScheme==='CREDIT'&&x.creditLimit<=0)return 'Skema KREDIT membutuhkan plafond kredit lebih dari Rp0.';
  if(x.paymentScheme==='CREDIT'&&x.creditDays<=0)return 'Skema KREDIT membutuhkan termin hari.';
  return '';
}
export default async request=>{
  try{assertIndriSession(request);}catch(e){return json({message:e.message},e.status||401);}
  if(request.method==='GET')return json({items:await list()});
  if(request.method==='POST'||request.method==='PUT'){
    let b;try{b=await request.json();}catch{return json({message:'Data tidak valid.'},400);}
    let existing={};
    if(request.method==='PUT'){const id=clean(b.id,80);if(!id)return json({message:'ID pelanggan tidak valid.'},400);existing=await db().get(key(id),{type:'json',consistency:'strong'});if(!existing)return json({message:'Master pelanggan tidak ditemukan.'},404);}
    const item=normalize(b,existing),error=validate(item);if(error)return json({message:error},400);
    if(!item.customerCode)item.customerCode='CUS-CGK-'+String(Date.now()).slice(-7);
    await db().setJSON(key(item.id),item);return json({ok:true,item},request.method==='POST'?201:200);
  }
  if(request.method==='DELETE'){const id=clean(new URL(request.url).searchParams.get('id'),80);if(!id)return json({message:'ID pelanggan tidak valid.'},400);const item=await db().get(key(id),{type:'json',consistency:'strong'});if(!item)return json({message:'Master pelanggan tidak ditemukan.'},404);item.active=false;item.updatedAt=new Date().toISOString();await db().setJSON(key(id),item);return json({ok:true,item});}
  return json({message:'Metode tidak diizinkan.'},405);
};
export const config={path:'/.netlify/functions/indri-cgk-customers',method:['GET','POST','PUT','DELETE']};
