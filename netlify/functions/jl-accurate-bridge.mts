import crypto from 'node:crypto';
import type {Config} from '@netlify/functions';
import {accurateConfigStatus, accurateGet, resolveAccurateConnection, validateAccurateBranch} from './_accurate-core.mjs';
const clean=(v,n=160)=>String(v??'').trim().slice(0,n);
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
function bridgeAuth(){
  const dedicated=clean(Netlify.env.get('LIBRA_JL_BRIDGE_SECRET'),1000);
  if(dedicated.length>=32)return {key:dedicated,mode:'DEDICATED'};
  const gateway=clean(Netlify.env.get('JL_SSOT_GATEWAY_TOKEN'),1000);
  if(gateway.length>=32)return {key:crypto.createHmac('sha256',gateway).update('JLX_ACCURATE_PREFLIGHT_V1').digest('hex'),mode:'DERIVED_SSOT_READ_ONLY'};
  return {key:'',mode:'MISSING'};
}
async function master(resource,no){
  if (!no) return null;
  const {data}=await accurateGet(resource,'list',{'sp.pageSize':20,'sp.page':1,fields:'id,no,name','filter.no.op':'EQUAL','filter.no.val[0]':no});
  const rows=Array.isArray(data?.d)?data.d:Array.isArray(data?.d?.data)?data.d.data:[];
  const matches=[];
  for(const row of rows){
    if(row.id==null)continue;
    const {data:detail}=await accurateGet(resource,'detail',{id:row.id});
    const value=detail?.d||detail?.r;
    if(value&&clean(value.no)===no)matches.push(value);
  }
  if(matches.length!==1)return null;
  const x=matches[0];
  if(x.suspended===true||x.disabled===true||x.active===false)return null;
  return {id:x.id,no:clean(x.no),name:clean(x.name,240)};
}
export default async (request:Request)=>{
  if(request.method!=='POST')return json({ok:false,message:'Method not allowed'},405);
  const auth=bridgeAuth(),secret=auth.key,stamp=request.headers.get('x-jl-timestamp')||'',signature=request.headers.get('x-jl-signature')||'';
  if(secret.length<32)return json({ok:false,message:'Jalur JL–Libra belum dikonfigurasi.',authMode:auth.mode},503);
  if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>60000||! /^[a-f0-9]{64}$/.test(signature))return json({ok:false,message:'Unauthorized'},401);
  const raw=await request.text();if(Buffer.byteLength(raw)>32000)return json({ok:false,message:'Request terlalu besar'},413);
  const expected=crypto.createHmac('sha256',secret).update(`${stamp}.${raw}`).digest('hex');
  if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))return json({ok:false,message:'Unauthorized'},401);
  try{
    const body=JSON.parse(raw);
    if(!['preview','preview_intent'].includes(body.action))return json({ok:false,message:'Bridge tahap ini hanya preview; posting tidak diizinkan.'},400);
    if(body.action==='preview_intent'){
      const intent=body.intent||{};
      const allowedTypes=new Set(['SALES_INVOICE','PURCHASE_INVOICE','SALES_RECEIPT','CUSTOMER_ADVANCE','CUSTOMER_ADVANCE_APPLY']);
      if(intent.source!=='JLX_DJJ'||intent.postingGuard!=='OUTBOX_ONLY_NO_ACCURATE_WRITE'||!allowedTypes.has(clean(intent.intentType,60)))throw new Error('Accounting intent JLX tidak valid.');
      if(!clean(intent.idempotencyKey,220))throw new Error('Idempotency key accounting intent wajib tersedia.');
      const config=accurateConfigStatus();
      if(!config.configured)return json({ok:true,ready:false,masterReady:false,schemaReady:false,intentType:intent.intentType,reasons:['Koneksi Accurate Libra belum dikonfigurasi.'],guard:'READ_ONLY_NO_POST',postingEnabled:false,authMode:auth.mode});
      const connection=await resolveAccurateConnection(),db=connection.database||{},databaseName=clean(db.alias||db.name||db.databaseName||db.companyName),expectedDb=clean(Netlify.env.get('ACCURATE_PRODUCTION_DATABASE_NAME')),reasons:string[]=[];
      if(!databaseName||!expectedDb||databaseName.toLowerCase()!==expectedDb.toLowerCase()||/(test|tes|uat|sandbox)/i.test(databaseName))reasons.push('Identitas database production Accurate Libra belum cocok.');
      const branchTarget=clean(intent.dimensions?.branchName||'JLX DJJ',160),branch=await validateAccurateBranch(branchTarget);
      if(!branch.ok)reasons.push(`Cabang Accurate ${branchTarget} belum ditemukan.`);
      const customerNo=clean(intent.customer?.no||'C.00399',120),customer=await master('customer',customerNo);
      if(!customer)reasons.push(`Customer Accurate ${customerNo} belum valid/aktif.`);
      let item=null,vendor=null;
      if(intent.intentType==='SALES_INVOICE'){
        const itemNo=clean(intent.item?.no,120);item=await master('item',itemNo);
        if(!item)reasons.push(`Item penjualan Accurate ${itemNo||'-'} belum valid/aktif.`);
      }
      if(intent.intentType==='PURCHASE_INVOICE'){
        const vendorNo=clean(intent.vendor?.no,120),itemNo=clean(intent.item?.no,120);
        vendor=await master('vendor',vendorNo);item=await master('item',itemNo);
        if(!vendor)reasons.push(`Vendor Accurate ${vendorNo||'-'} belum valid/aktif.`);
        if(!item)reasons.push(`Item pembelian Accurate ${itemNo||'-'} belum valid/aktif.`);
      }
      const schemaReasons:string[]=[];
      if(intent.intentType==='SALES_INVOICE'){
        schemaReasons.push('Field API Salesman Wahyudi Utomo belum disertifikasi pada payload Sales Invoice.');
        schemaReasons.push('Field API Proyek/Departemen JLX DJJ belum disertifikasi pada detail transaksi.');
        schemaReasons.push('Applicability/field Gudang JLX DJJ untuk item jasa belum disertifikasi.');
        schemaReasons.push('Perlakuan pajak item 100027 dan read-back total belum disertifikasi.');
      }else if(intent.intentType==='PURCHASE_INVOICE'){
        schemaReasons.push('Endpoint/payload Purchase Invoice Lion belum disertifikasi terhadap database Accurate.');
        schemaReasons.push('Field API Proyek/Departemen JLX DJJ dan applicability Gudang pada item jasa belum disertifikasi.');
        schemaReasons.push('Perlakuan pajak item 100026 belum disertifikasi.');
      }else if(intent.intentType==='SALES_RECEIPT'){
        schemaReasons.push('Akun kas/bank/clearing sesuai metode pembayaran belum dimapping.');
      }else if(intent.intentType==='CUSTOMER_ADVANCE'){
        schemaReasons.push('Tax mode Sales Down Payment dan akun penerimaan top-up belum dimapping untuk JLX DJJ.');
      }else if(intent.intentType==='CUSTOMER_ADVANCE_APPLY'){
        schemaReasons.push('Nomor Sales Down Payment sumber harus di-resolve dan diverifikasi sebelum detailDownPayment diterapkan.');
      }
      const allReasons=[...reasons,...schemaReasons];
      return json({ok:true,ready:false,masterReady:reasons.length===0,schemaReady:false,databaseName,branch:{target:branchTarget,found:branch.found||null},customer,item,vendor,intentType:intent.intentType,idempotencyKey:intent.idempotencyKey,intent,reasons:allReasons,guard:'READ_ONLY_NO_POST',postingEnabled:false});
    }
    const invoice=body.invoice,mapping=body.mapping||{};
    if(invoice?.source!=='JL_EXPRESS'||invoice?.guard!=='PREVIEW_ONLY_NO_POST'||!Array.isArray(invoice.lines)||!invoice.lines.length||invoice.lines.length>8)throw new Error('Preview billing tidak valid.');
    const validMoney=n=>Number.isSafeInteger(n)&&n>=0;
    if(!invoice.lines.every(x=>validMoney(x.amount)&&x.amount>0)||!validMoney(invoice.tax)||!validMoney(invoice.total)||invoice.total<=0||invoice.lines.reduce((s,x)=>s+x.amount,0)+invoice.tax!==invoice.total)throw new Error('Total invoice tidak cocok.');
    const config=accurateConfigStatus();
    if(!config.configured)return json({ok:true,ready:false,reasons:['Koneksi Accurate Libra belum dikonfigurasi.'],guard:'READ_ONLY_NO_POST'});
    const connection=await resolveAccurateConnection(),db=connection.database||{};
    const databaseName=clean(db.alias||db.name||db.databaseName||db.companyName);
    const reasons=[];
    const expectedDb=clean(Netlify.env.get('ACCURATE_PRODUCTION_DATABASE_NAME'));
    if(!databaseName||!expectedDb||databaseName.toLowerCase()!==expectedDb.toLowerCase()||/(test|tes|uat|sandbox)/i.test(databaseName))reasons.push('Identitas database production Accurate Libra belum cocok.');
    const branch=await validateAccurateBranch(config.branchName);
    if(!branch.ok)reasons.push('Cabang Accurate JL belum ditemukan.');
    const customer=await master('customer',clean(mapping.customerNo));
    if(!customer)reasons.push('Pilih kode pelanggan Accurate yang valid.');
    const items=[],cache=new Map();
    for(const line of invoice.lines){
      const no=clean(mapping.items?.[line.code]);
      if(!cache.has(no))cache.set(no,await master('item',no));
      const item=cache.get(no);items.push({code:line.code,item,amount:line.amount});
      if(!item)reasons.push(`Mapping jasa ${line.code} belum valid.`);
    }
    // A declared tax amount is not a verified Accurate tax configuration.
    // Do not create arbitrary tax lines or assume the tax on item masters.
    reasons.push('Mapping pajak Accurate dan read-back total wajib disertifikasi sebelum posting.');
    return json({ok:true,ready:false,masterReady:reasons.length===1,databaseName,branchName:branch.target,customer,items,invoice,reasons,guard:'READ_ONLY_NO_POST',postingEnabled:false});
  }catch{return json({ok:false,message:'Preview Accurate gagal. Periksa koneksi, izin baca master, dan mapping di Libra.'},422);}
};
export const config:Config={path:'/api/jl-accurate-bridge',rateLimit:{windowSize:60,windowLimit:20,aggregateBy:'ip',action:'rate_limit'}};
