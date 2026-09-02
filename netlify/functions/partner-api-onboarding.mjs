import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
const store=()=>getStore('libra-api-onboarding');
const clean=(v,n=200)=>String(v||'').trim().slice(0,n);
export default async request=>{
 if(request.method!=='POST')return Response.json({message:'Metode tidak diizinkan.'},{status:405});
 let body;try{body=await request.json();}catch{return Response.json({message:'Permintaan tidak valid.'},{status:400});}
 const companyName=clean(body.companyName,160),picName=clean(body.picName,120),phone=clean(body.phone,40),email=clean(body.email,160);if(!companyName||!picName||!phone||!email||!email.includes('@'))return Response.json({message:'Nama perusahaan, PIC, HP dan email valid wajib diisi.'},{status:400});
 const applicationId=`API-ONB-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;const createdAt=new Date().toISOString();const row={applicationId,status:'PENDING_REVIEW',companyName,picName,phone,email,businessType:clean(body.businessType,100),monthlyVolumeKg:Math.max(0,Number(body.monthlyVolumeKg)||0),integrationUse:clean(body.integrationUse,500),technicalContact:clean(body.technicalContact,160),callbackUrl:clean(body.callbackUrl,300),createdAt,updatedAt:createdAt};
 await store().setJSON(`application/${applicationId}`,row,{onlyIfNew:true});return Response.json({ok:true,applicationId,status:row.status,message:'Pengajuan onboarding API sudah diterima Admin Libra.'},{status:201});
};
export const config={path:'/.netlify/functions/partner-api-onboarding',method:'POST',rateLimit:{windowSize:3600,windowLimit:5,aggregateBy:'ip',action:'rate_limit'}};