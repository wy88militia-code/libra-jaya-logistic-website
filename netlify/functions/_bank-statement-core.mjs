import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME='libra-bank-statements';
const store=()=>getStore(STORE_NAME);
const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const money=value=>Math.round((Number(value)||0)*100)/100;
const PUBLIC_FIELDS=['statementId','createdAt','createdBy','createdByRole','status','confirmedAt','confirmedBy','checksum','files','model','responseId','analysis','validation','error'];

function publicRecord(record){
  const out={};
  for(const key of PUBLIC_FIELDS)if(record?.[key]!==undefined)out[key]=record[key];
  return out;
}
function encryptionKey(){
  const secret=String(process.env.BANK_STATEMENT_ENCRYPTION_KEY||process.env.ADMIN_SESSION_SECRET||'');
  if(secret.length<32)throw new Error('Kunci enkripsi rekening koran belum dikonfigurasi.');
  return crypto.createHash('sha256').update('LIBRA_BANK_STATEMENT_V1|'+secret).digest();
}
function encryptBytes(buffer){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv);
  const encrypted=Buffer.concat([cipher.update(buffer),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
}
function parseJsonOutput(data){
  let text=typeof data?.output_text==='string'?data.output_text.trim():'';
  if(!text)for(const item of data?.output||[])for(const part of item?.content||[])if(part?.type==='output_text'&&part.text)text+=part.text;
  text=text.trim();
  if(!text)throw new Error('AI tidak mengembalikan hasil terstruktur.');
  return JSON.parse(text);
}
function parseDate(value){const raw=clean(value,20);return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:null;}
function normalizeAnalysis(value){
  const tx=(Array.isArray(value?.transactions)?value.transactions:[]).slice(0,2000).map((row,index)=>({
    row:index+1,date:parseDate(row.date),description:clean(row.description,600),reference:clean(row.reference,180)||null,
    debit:Math.max(0,money(row.debit)),credit:Math.max(0,money(row.credit)),
    balance:row.balance===null||row.balance===undefined?null:money(row.balance),
    confidence:Math.max(0,Math.min(1,Number(row.confidence)||0)),
    needsReview:Boolean(row.needs_review),issue:clean(row.issue,300)||null
  }));
  return {
    documentType:clean(value?.document_type,40)||'UNKNOWN',bankName:clean(value?.bank_name,120)||null,
    periodStart:parseDate(value?.period_start),periodEnd:parseDate(value?.period_end),
    accountLast4:clean(value?.account_last4,4).replace(/\D/g,'')||null,currency:clean(value?.currency,8)||'IDR',
    openingBalance:value?.opening_balance===null||value?.opening_balance===undefined?null:money(value.opening_balance),
    closingBalance:value?.closing_balance===null||value?.closing_balance===undefined?null:money(value.closing_balance),
    transactionOrder:['ASC','DESC'].includes(value?.transaction_order)?value.transaction_order:'UNKNOWN',
    transactions:tx,warnings:(Array.isArray(value?.warnings)?value.warnings:[]).slice(0,50).map(x=>clean(x,500)).filter(Boolean)
  };
}
function validateAnalysis(analysis){
  const debit=money(analysis.transactions.reduce((sum,row)=>sum+row.debit,0));
  const credit=money(analysis.transactions.reduce((sum,row)=>sum+row.credit,0));
  const both=analysis.transactions.filter(row=>row.debit>0&&row.credit>0).length;
  const empty=analysis.transactions.filter(row=>row.debit===0&&row.credit===0).length;
  const lowConfidence=analysis.transactions.filter(row=>row.confidence<0.8||row.needsReview).length;
  let balanceDifference=null,balanceCheck='NOT_AVAILABLE';
  if(analysis.openingBalance!==null&&analysis.closingBalance!==null){
    balanceDifference=money(analysis.openingBalance+credit-debit-analysis.closingBalance);
    balanceCheck=Math.abs(balanceDifference)<=1?'PASS':'REVIEW';
  }
  const issues=[];
  if(analysis.documentType!=='BANK_STATEMENT')issues.push('Dokumen belum teridentifikasi pasti sebagai rekening koran.');
  if(!analysis.transactions.length)issues.push('Tidak ada transaksi yang berhasil dibaca.');
  if(both)issues.push(String(both)+' baris memiliki debit dan kredit sekaligus.');
  if(empty)issues.push(String(empty)+' baris tidak memiliki nilai debit maupun kredit.');
  if(lowConfidence)issues.push(String(lowConfidence)+' baris perlu diperiksa akuntan.');
  if(balanceCheck==='REVIEW')issues.push('Rumus saldo awal + kredit - debit tidak sama dengan saldo akhir.');
  return {transactionCount:analysis.transactions.length,totalDebit:debit,totalCredit:credit,balanceCheck,balanceDifference,lowConfidenceCount:lowConfidence,issues,readyForReview:analysis.transactions.length>0};
}
function responseSchema(){
  const nullableNumber={anyOf:[{type:'number'},{type:'null'}]};
  const nullableString={anyOf:[{type:'string'},{type:'null'}]};
  return {type:'object',additionalProperties:false,required:['document_type','bank_name','period_start','period_end','account_last4','currency','opening_balance','closing_balance','transaction_order','transactions','warnings'],properties:{
    document_type:{type:'string',enum:['BANK_STATEMENT','UNKNOWN']},bank_name:nullableString,period_start:nullableString,period_end:nullableString,account_last4:nullableString,currency:{type:'string'},
    opening_balance:nullableNumber,closing_balance:nullableNumber,transaction_order:{type:'string',enum:['ASC','DESC','UNKNOWN']},
    transactions:{type:'array',items:{type:'object',additionalProperties:false,required:['date','description','reference','debit','credit','balance','confidence','needs_review','issue'],properties:{
      date:nullableString,description:{type:'string'},reference:nullableString,debit:{type:'number'},credit:{type:'number'},balance:nullableNumber,
      confidence:{type:'number'},needs_review:{type:'boolean'},issue:nullableString
    }}},warnings:{type:'array',items:{type:'string'}}
  }};
}
async function analyze(files){
  const apiKey=String(process.env.OPENAI_API_KEY||'').trim();
  if(!apiKey)throw new Error('OPENAI_API_KEY belum dikonfigurasi.');
  const model=clean(process.env.LIBRA_BANK_AI_MODEL||process.env.LIBRA_AI_MODEL||'gpt-5.6-luna',80);
  const content=[];
  for(const file of files){
    const base64=file.buffer.toString('base64');
    if(file.type==='application/pdf')content.push({type:'input_file',filename:file.name,file_data:'data:application/pdf;base64,'+base64,detail:'high'});
    else content.push({type:'input_image',image_url:'data:'+file.type+';base64,'+base64,detail:'high'});
  }
  content.push({type:'input_text',text:[
    'Baca dokumen rekening koran PT Libra Jaya Logistic secara teliti.',
    'Urutan file/foto adalah urutan halaman. Jangan mengarang angka atau deskripsi yang tidak terbaca.',
    'Ekstrak seluruh transaksi: tanggal ISO YYYY-MM-DD, deskripsi lengkap, referensi, debit, kredit, dan saldo setelah transaksi bila tersedia.',
    'Gunakan angka positif untuk debit dan kredit. Jika kolom mutasi hanya satu dengan tanda, petakan minus ke debit dan plus ke kredit.',
    'Untuk informasi kabur set confidence rendah, needs_review=true, dan jelaskan issue.',
    'Nomor rekening hanya boleh dikembalikan 4 digit terakhir. Jangan keluarkan nomor lengkap, nama pribadi, alamat, token, atau credential.',
    'Tentukan saldo awal/akhir dan urutan transaksi ASC atau DESC. Jika tidak ada, gunakan null.'
  ].join('\n')});
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},body:JSON.stringify({
    model,input:[{role:'user',content}],text:{format:{type:'json_schema',name:'libra_bank_statement',strict:true,schema:responseSchema()}},max_output_tokens:16000
  })});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(clean(data?.error?.message||('OpenAI HTTP '+response.status),600));
  return {model,responseId:clean(data.id,120)||null,analysis:normalizeAnalysis(parseJsonOutput(data))};
}
async function getRecord(id,withMetadata=false){
  const key='statement/'+clean(id,100);
  return withMetadata?store().getWithMetadata(key,{type:'json',consistency:'strong'}):store().get(key,{type:'json',consistency:'strong'});
}
export async function createBankStatementDraft({files,session}){
  if(!Array.isArray(files)||!files.length)throw new Error('Pilih PDF atau foto rekening koran.');
  const combined=crypto.createHash('sha256');
  const fileMeta=files.map((file,index)=>{combined.update(file.buffer);const checksum=sha(file.buffer);return {index:index+1,name:clean(file.name,180),type:file.type,size:file.buffer.length,checksum};});
  const checksum=combined.digest('hex'),idx=await store().get('checksum/'+checksum,{type:'text',consistency:'strong'});
  if(idx){const prior=await getRecord(idx);if(prior)return {duplicate:true,record:publicRecord(prior)};}
  const statementId='BKS-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex'),createdAt=now();
  const lock=await store().set('checksum/'+checksum,statementId,{onlyIfNew:true});
  if(!lock.modified){const existingId=await store().get('checksum/'+checksum,{type:'text',consistency:'strong'});const prior=existingId?await getRecord(existingId):null;if(prior)return {duplicate:true,record:publicRecord(prior)};}
  const rawKeys=[];
  try{
    for(let i=0;i<files.length;i++){const key='raw/'+statementId+'/'+String(i+1).padStart(3,'0');await store().set(key,encryptBytes(files[i].buffer));rawKeys.push(key);}
    let record={statementId,createdAt,createdBy:clean(session.username,100),createdByRole:clean(session.role,40),status:'PROCESSING',checksum,files:fileMeta,rawKeys,model:null,responseId:null,analysis:null,validation:null,error:null};
    await store().setJSON('statement/'+statementId,record,{onlyIfNew:true});
    try{
      const result=await analyze(files),analysis=result.analysis,validation=validateAnalysis(analysis);
      record={...record,status:'REVIEW_REQUIRED',model:result.model,responseId:result.responseId,analysis,validation,updatedAt:now()};
    }catch(error){record={...record,status:'EXTRACTION_FAILED',error:clean(error?.message||error,800),updatedAt:now()};}
    await store().setJSON('statement/'+statementId,record);
    return {duplicate:false,record:publicRecord(record)};
  }catch(error){
    await store().delete('checksum/'+checksum).catch(()=>{});
    for(const key of rawKeys)await store().delete(key).catch(()=>{});
    throw error;
  }
}
export async function confirmBankStatement({statementId,session,note}){
  const id=clean(statementId,100);if(!id)throw new Error('Statement ID wajib diisi.');
  for(let attempt=0;attempt<5;attempt++){
    const entry=await getRecord(id,true),current=entry?.data;
    if(!current)throw new Error('Rekening koran tidak ditemukan.');
    if(current.status==='CONFIRMED')return {alreadyConfirmed:true,record:publicRecord(current)};
    if(current.status!=='REVIEW_REQUIRED')throw new Error('Hanya draft REVIEW_REQUIRED yang dapat dikonfirmasi.');
    const next={...current,status:'CONFIRMED',confirmedAt:now(),confirmedBy:clean(session.username,100),confirmedByRole:clean(session.role,40),reviewNote:clean(note,1000)||null,updatedAt:now()};
    const result=await store().setJSON('statement/'+id,next,{onlyIfMatch:entry.etag});
    if(result.modified)return {alreadyConfirmed:false,record:publicRecord(next)};
  }
  throw new Error('Data sedang diperbarui. Muat ulang lalu coba kembali.');
}
export async function listBankStatements(limit=20){
  const listed=await store().list({prefix:'statement/'}),rows=[];
  for(const blob of listed.blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(Number(limit)||20,100)))){
    const row=await store().get(blob.key,{type:'json'});if(row)rows.push(publicRecord(row));
  }
  return rows;
}
