import type { Config } from '@netlify/functions';
import { accurateGet, resolveAccurateConnection } from './_accurate-core.mjs';
import { postHcSalesInvoice } from './_hc-accurate-si-production-core.mts';

const clean=(v:unknown,n=500)=>String(v??'').trim().slice(0,n);
const money=(v:unknown)=>Math.max(0,Math.round(Number(v)||0));
const norm=(v:unknown)=>clean(v,240).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
function authorized(req:Request){const expected=clean(Netlify.env.get('LIBRA_HC_BRIDGE_SECRET'),500);const got=clean(req.headers.get('x-libra-hc-secret'),500);return Boolean(expected&&got&&expected===got);}
function customerRow(x:any){return {id:x?.id??null,no:clean(x?.no,120),name:clean(x?.name,240),suspended:x?.suspended,disabled:x?.disabled,active:x?.active};}
function usableCustomer(x:any){return Boolean(clean(x?.no,120)&&clean(x?.name,240));}
function statusBlocked(x:any){return x?.active===false||x?.disabled===true||x?.suspended===true;}
function customerRows(data:any){
  const direct=[data?.d,data?.d?.data,data?.d?.rows,data?.d?.list,data?.d?.r,data?.data,data?.rows,data?.list,data?.r];
  for(const value of direct)if(Array.isArray(value))return value;
  const seen=new Set<any>();
  const walk=(value:any,depth:number):any[]=>{
    if(value==null||depth>4)return [];
    if(Array.isArray(value)){
      if(value.some((x:any)=>x&&typeof x==='object'&&('no' in x||'name' in x||'id' in x)))return value;
      for(const x of value){const found=walk(x,depth+1);if(found.length)return found;}
      return [];
    }
    if(typeof value!=='object'||seen.has(value))return [];
    seen.add(value);
    for(const x of Object.values(value)){const found=walk(x,depth+1);if(found.length)return found;}
    return [];
  };
  return walk(data,0);
}
function responseShape(data:any){
  const d=data?.d;
  const topKeys=data&&typeof data==='object'?Object.keys(data).slice(0,20):[];
  const dKeys=d&&typeof d==='object'&&!Array.isArray(d)?Object.keys(d).slice(0,20):[];
  return {topKeys,dType:Array.isArray(d)?'array':typeof d,dKeys,rowCount:customerRows(data).length};
}
function responsePageCount(data:any){
  const value=Number(data?.sp?.pageCount??data?.d?.sp?.pageCount??data?.pagination?.pageCount??data?.d?.pagination?.pageCount);
  return Number.isFinite(value)&&value>0?Math.min(value,100):1;
}
function normalizeCustomerNo(v:any){return String(v??'').trim().toUpperCase().replace(/\s+/g,'');}
async function resolveCustomerByDetail(no:string){
  const candidates=[no,normalizeCustomerNo(no)];
  for(const candidate of [...new Set(candidates)].filter(Boolean)){
    for(const key of ['no','id']){
      try{
        const {data}=await accurateGet('customer','detail',{[key]:candidate});
        const raw=data?.d&&typeof data.d==='object'&&!Array.isArray(data.d)?data.d:data;
        const row=customerRow(raw);
        if(usableCustomer(row)&&normalizeCustomerNo(row.no)===normalizeCustomerNo(no))return row;
      }catch{}
    }
  }
  return null;
}
// Deployment marker: MASTER_ACCURATE_VERIFY_GATE_V2
const MASTER_ACCURATE_VERIFY_GATE_V2=true;
async function resolveCustomer(customerNo:string,sourceName:string){const no=clean(customerNo,120),source=clean(sourceName,240);if(!no)return {selected:null,recommended:null,matches:[],count:0,sourceName:source,customerNo:no,mapping:'MASTER_ACCURATE_ID',registered:false,error:'ID Accurate dari Master Konsinyi kosong.'};try{let data:any;try{({data}=await accurateGet('customer','list',{'sp.pageSize':20,'sp.page':1,'fields':'id,no,name,suspended,disabled,active','filter.no.op':'EQUAL','filter.no.val[0]':no}));}catch{({data}=await accurateGet('customer','list',{'sp.pageSize':20,'sp.page':1,'fields':'id,no,name','filter.no.op':'EQUAL','filter.no.val[0]':no}));}const raw=customerRows(data);const matches=raw.map(customerRow).filter(usableCustomer);let exact=matches.find((x:any)=>normalizeCustomerNo(x.no)===normalizeCustomerNo(no))||null;if(!exact)exact=await resolveCustomerByDetail(no);if(!exact){let page=1,pageCount=1;do{let scan:any;try{({data:scan}=await accurateGet('customer','list',{'sp.pageSize':100,'sp.page':page,'fields':'id,no,name,suspended,disabled,active'}));}catch{({data:scan}=await accurateGet('customer','list',{'sp.pageSize':100,'sp.page':page,'fields':'id,no,name'}));}const rows=(customerRows(scan)).map(customerRow).filter(usableCustomer);exact=rows.find((x:any)=>normalizeCustomerNo(x.no)===normalizeCustomerNo(no))||null;pageCount=responsePageCount(scan);page+=1;}while(!exact&&page<=pageCount);}if(!exact){let audit:any=null;try{audit=await auditCustomers(no,source);}catch{}return {selected:null,recommended:null,matches,count:matches.length,sourceName:source,customerNo:no,queriedNo:no,mapping:'MASTER_ACCURATE_ID',registered:false,error:`ID Customer Accurate ${no} tidak dapat diverifikasi pada database Accurate aktif.`,diagnostic:audit};}return {selected:exact,recommended:exact,matches:[exact],count:1,sourceName:source,customerNo:no,queriedNo:no,mapping:'MASTER_ACCURATE_ID',registered:true,verifiedCustomerNo:true};}catch(e:any){return {selected:null,recommended:null,matches:[],count:0,sourceName:source,customerNo:no,queriedNo:no,mapping:'MASTER_ACCURATE_ID',registered:false,error:clean(e?.message||e,500)};}}
async function auditCustomers(customerNo:string,customerName:string){const targetNo=norm(customerNo),targetName=norm(customerName);let page=1,pageCount=1,totalVisible=0,totalRaw=0,statusBlockedCount=0,first:any[]=[],last:any[]=[],noMatches:any[]=[],nameMatches:any[]=[];do{let data:any;try{({data}=await accurateGet('customer','list',{'sp.pageSize':100,'sp.page':page,'fields':'id,no,name,suspended,disabled,active'}));}catch{({data}=await accurateGet('customer','list',{'sp.pageSize':100,'sp.page':page,'fields':'id,no,name'}));}const rawRows=(customerRows(data)).map(customerRow);totalRaw+=rawRows.length;statusBlockedCount+=rawRows.filter(statusBlocked).length;const rows=rawRows.filter(usableCustomer);totalVisible+=rows.length;if(page===1)first=rows.slice(0,5);last=rows.slice(-5);for(const r of rows){if(targetNo&&normalizeCustomerNo(r.no)===normalizeCustomerNo(customerNo))noMatches.push(r);if(targetName&&(norm(r.name)===targetName||norm(r.name).includes(targetName)||targetName.includes(norm(r.name))))nameMatches.push(r);}pageCount=responsePageCount(data);page+=1;}while(page<=pageCount);let shape:any=null;try{const {data}=await accurateGet('customer','list',{'sp.pageSize':3,'sp.page':1,'fields':'id,no,name'});shape=responseShape(data);}catch{}return {totalRaw,totalVisible,statusBlockedCount,pageCount,shape,first:first.map(({id,no,name})=>({id,no,name})),last:last.map(({id,no,name})=>({id,no,name})),noMatches:noMatches.map(({id,no,name})=>({id,no,name})),nameMatches:nameMatches.slice(0,20).map(({id,no,name})=>({id,no,name}))};}
function invoicePreview(body:any){const customerName=clean(body?.customerName,240),customerNo=clean(body?.customerNo,120),goods=Array.isArray(body?.goods)?body.goods:[];if(!customerNo)throw new Error('ID Customer Accurate wajib.');if(!goods.length)throw new Error('Rincian barang kosong.');const detailItem:any[]=[];let cargo=0,totalKg=0,totalKoli=0;for(const r of goods){const name=clean(r?.name||r?.description,160),kg=Number(r?.kg??r?.weight)||0,koli=Number(r?.koli)||0,rate=money(r?.rate??r?.tariff);if(!name||kg<=0||rate<=0)throw new Error('Nama barang, kg, dan tarif wajib > 0.');const total=money(kg*rate);cargo+=total;totalKg+=kg;totalKoli+=koli;detailItem.push({itemNo:'100001',quantity:kg,unitPrice:rate,detailName:`Jasa Kargo Udara HC${customerName?' - '+customerName:''} - ${name}`,detailNotes:`${koli} koli`,departmentName:'Kargo HC Sentani',projectName:'HC SPR'});}const insurance=money(body?.insuranceAdmin),handling=money(body?.handling);if(insurance>0)detailItem.push({itemNo:'100020',quantity:1,unitPrice:insurance,detailName:`Asuransi+Admin WMA${customerName?' - '+customerName:''}`,departmentName:'Kargo HC Sentani',projectName:'HC SPR'});if(handling>0)detailItem.push({itemNo:'100014',quantity:1,unitPrice:handling,detailName:`Handling Fee${customerName?' - '+customerName:''}`,departmentName:'Kargo HC Sentani',projectName:'HC SPR'});const computed=money(cargo+insurance+handling),declared=money(body?.total);if(computed!==declared)throw new Error(`Total detail Rp${computed.toLocaleString('id-ID')} tidak sama dengan Total Tagihan Rp${declared.toLocaleString('id-ID')}.`);return {guard:'PREVIEW_ONLY_NO_POST',documentType:'SALES_INVOICE',customer:{no:customerNo,name:customerName},header:{branchName:'HC Kargo Sentani',projectName:'HC SPR',currencyCode:'IDR'},summary:{lineCount:detailItem.length,totalKoli,totalKg,cargo,insuranceAdmin:insurance,handling,total:computed},detailItem};}
export default async(req:Request)=>{if(req.method!=='POST')return Response.json({ok:false,error:'Method Not Allowed'},{status:405});if(!authorized(req))return Response.json({ok:false,error:'Unauthorized bridge'},{status:404});try{const body:any=await req.json(),action=clean(body?.action,40).toLowerCase();if(action==='probe_customer'){const result=await resolveCustomer(clean(body?.customerNo,120),clean(body?.customerName,240));return Response.json({ok:true,action,result},{headers:{'cache-control':'no-store'}});}if(action==='debug_customer_lookup'){const customerNo=clean(body?.customerNo,120),customerName=clean(body?.customerName,240);const connection:any=await resolveAccurateConnection();const audit=await auditCustomers(customerNo,customerName);const detail=await resolveCustomerByDetail(customerNo);return Response.json({ok:true,action,mode:connection?.mode||null,database:{id:connection?.database?.id??null,alias:clean(connection?.database?.alias||connection?.database?.name||connection?.database?.databaseName||connection?.database?.companyName,240)},customerNo,detail:detail?{id:detail.id,no:detail.no,name:detail.name}:null,audit},{headers:{'cache-control':'no-store'}});}if(action==='diagnose_connection'){const connection:any=await resolveAccurateConnection();const db=connection?.database||null;const audit=await auditCustomers(clean(body?.customerNo,120),clean(body?.customerName,240));return Response.json({ok:true,action,mode:connection?.mode||null,database:{id:db?.id??null,alias:clean(db?.alias||db?.name||db?.databaseName||db?.companyName,240)},host:clean(connection?.host,300),audit},{headers:{'cache-control':'no-store'}});}if(action==='prepare_sales_invoice'){const result=invoicePreview(body);return Response.json({ok:true,action,result},{headers:{'cache-control':'no-store'}});}if(action==='post_sales_invoice'){if(clean(body?.confirmation,80)!=='POST_HC_SALES_INVOICE')return Response.json({ok:false,error:'Konfirmasi POST Faktur Penjualan HC tidak valid.'},{status:400,headers:{'cache-control':'no-store'}});const sourceId=clean(body?.sourceId,120);if(!sourceId)throw new Error('sourceId/tagihan ID wajib untuk idempotensi.');const preview=invoicePreview(body);const result=await postHcSalesInvoice(preview,sourceId,{transDate:clean(body?.transDate,80),description:clean(body?.description||`Libra Tools HC ${sourceId}`,500)});return Response.json({ok:true,action,result},{headers:{'cache-control':'no-store'}});}return Response.json({ok:false,error:'Aksi bridge belum diizinkan.'},{status:400,headers:{'cache-control':'no-store'}});}catch(e:any){const msg=clean(e?.message||e,1000);return Response.json({ok:false,error:msg},{status:500,headers:{'cache-control':'no-store'}});}};
export const config:Config={path:['/api/hc-accurate-bridge','/.netlify/functions/hc-accurate-bridge']};
