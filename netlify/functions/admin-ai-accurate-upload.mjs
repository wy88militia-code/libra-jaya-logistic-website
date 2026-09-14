import { createBankStatementDraft, confirmBankStatement } from './_bank-statement-core.mjs';
import { writeAdminAudit } from './_admin-audit-core.mjs';
import { canRoleAccessPath } from './_admin-rbac-core.mjs';
import { getAdminSession } from './_partner-core.mjs';

const MAX_TOTAL=5*1024*1024,MAX_FILES=10;
const ALLOWED=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
function json(body,status=200){return Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});}
function sameOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return origin===new URL(request.url).origin;}catch{return false;}}
export default async request=>{
  if(request.method!=='POST')return json({ok:false,message:'Metode tidak diizinkan.'},405);
  const session=getAdminSession(request);
  if(!session||!canRoleAccessPath(session.role,'/admin-ai-accurate-upload'))return json({ok:false,message:'Akses hanya untuk SUPERADMIN atau FINANCE.'},403);
  if(!sameOrigin(request))return json({ok:false,message:'Origin permintaan tidak valid.'},403);
  try{
    const type=String(request.headers.get('content-type')||'');
    if(type.includes('application/json')){
      const body=await request.json(),action=clean(body?.action,40);
      if(action!=='confirm')return json({ok:false,message:'Aksi tidak dikenal.'},400);
      const result=await confirmBankStatement({statementId:body.statementId,session,note:body.note});
      await writeAdminAudit({session,request,action:'BANK_STATEMENT_CONFIRM',entityType:'BANK_STATEMENT',entityId:result.record.statementId,after:{status:result.record.status,transactionCount:result.record.validation?.transactionCount},metadata:{alreadyConfirmed:result.alreadyConfirmed}});
      return json({ok:true,...result});
    }
    const form=await request.formData(),uploads=form.getAll('files').filter(item=>item&&typeof item.arrayBuffer==='function');
    if(!uploads.length)return json({ok:false,message:'Pilih satu PDF atau satu atau beberapa foto.'},400);
    if(uploads.length>MAX_FILES)return json({ok:false,message:'Maksimal 10 foto dalam satu unggahan.'},400);
    const pdfCount=uploads.filter(file=>file.type==='application/pdf').length;
    if(pdfCount&&uploads.length!==1)return json({ok:false,message:'PDF harus diunggah sendiri. Untuk foto, unggah beberapa foto sesuai urutan halaman.'},400);
    const files=[];let total=0;
    for(const upload of uploads){
      if(!ALLOWED.has(upload.type))return json({ok:false,message:'Format '+clean(upload.type,80)+' belum didukung. Gunakan PDF, JPG, PNG, atau foto HEIC yang dikonversi otomatis oleh halaman.'},400);
      const buffer=Buffer.from(await upload.arrayBuffer());total+=buffer.length;
      if(total>MAX_TOTAL)return json({ok:false,message:'Total file maksimal 5 MB setelah kompresi.'},413);
      files.push({name:clean(upload.name,180)||('page-'+files.length),type:upload.type,buffer});
    }
    const result=await createBankStatementDraft({files,session});
    await writeAdminAudit({session,request,action:result.duplicate?'BANK_STATEMENT_DUPLICATE':'BANK_STATEMENT_UPLOAD',entityType:'BANK_STATEMENT',entityId:result.record.statementId,after:{status:result.record.status,fileCount:result.record.files.length,transactionCount:result.record.validation?.transactionCount||0,balanceCheck:result.record.validation?.balanceCheck||null},metadata:{checksum:result.record.checksum}});
    return json({ok:true,...result});
  }catch(error){
    await writeAdminAudit({session,request,action:'BANK_STATEMENT_ERROR',entityType:'BANK_STATEMENT',entityId:null,status:'FAILED',note:clean(error?.message||error,500)}).catch(()=>{});
    return json({ok:false,message:clean(error?.message||'Pemrosesan gagal.',700)},400);
  }
};
export const config={path:'/admin-ai-accurate-upload',method:'POST',rateLimit:{windowSize:3600,windowLimit:30,aggregateBy:'ip',action:'rate_limit'}};
