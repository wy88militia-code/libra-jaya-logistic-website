import type { Config } from '@netlify/functions';
import { probeAccurateCustomerByName } from './_accurate-sales-order-core.mjs';

const clean=(v:unknown,n=500)=>String(v??'').trim().slice(0,n);
const money=(v:unknown)=>Math.max(0,Math.round(Number(v)||0));
function authorized(req:Request){const expected=clean(Netlify.env.get('LIBRA_HC_BRIDGE_SECRET'),500);const got=clean(req.headers.get('x-libra-hc-secret'),500);return Boolean(expected&&got&&expected===got);}
function salesInvoicePreview(body:any){
 const customerName=clean(body?.customerName,160),customerNo=clean(body?.customerNo,120),goods=Array.isArray(body?.goods)?body.goods:[];
 if(!customerName||!customerNo)throw new Error('Customer HC/Accurate wajib.');if(!goods.length)throw new Error('Rincian barang kosong.');
 const detailItem:any[]=[];let cargo=0,totalKg=0,totalKoli=0;
 for(const r of goods){const name=clean(r?.name||r?.description,160),kg=Number(r?.kg??r?.weight)||0,koli=Number(r?.koli)||0,rate=money(r?.rate??r?.tariff);if(!name||kg<=0||rate<=0)throw new Error('Nama barang, kg, dan tarif wajib > 0.');const total=money(kg*rate);cargo+=total;totalKg+=kg;totalKoli+=koli;detailItem.push({itemNo:'100001',quantity:kg,unitPrice:rate,detailName:`Jasa Kargo Udara HC - ${customerName} - ${name}`,detailNotes:`${koli} koli`,departmentName:'Kargo HC Sentani'});}
 const insurance=money(body?.insuranceAdmin),handling=money(body?.handling);
 if(insurance>0)detailItem.push({itemNo:'100020',quantity:1,unitPrice:insurance,detailName:`Asuransi+Admin WMA - ${customerName}`,departmentName:'Kargo HC Sentani'});
 if(handling>0)detailItem.push({itemNo:'100014',quantity:1,unitPrice:handling,detailName:`Handling Fee - ${customerName}`,departmentName:'Kargo HC Sentani'});
 const computed=money(cargo+insurance+handling),declared=money(body?.total);if(computed!==declared)throw new Error(`Total detail Rp${computed.toLocaleString('id-ID')} tidak sama dengan Total Tagihan Rp${declared.toLocaleString('id-ID')}.`);
 return {guard:'PREVIEW_ONLY_NO_POST',customer:{no:customerNo,name:customerName},header:{branchName:'HC Kargo Sentani',projectName:'HC SPR',salesmanName:'Wahyudi Utomo',currencyCode:'IDR'},summary:{lineCount:detailItem.length,totalKoli,totalKg,cargo,insuranceAdmin:insurance,handling,total:computed},detailItem};
}
export default async(req:Request)=>{if(req.method!=='POST')return new Response('Method Not Allowed',{status:405});if(!authorized(req))return new Response('Not Found',{status:404});try{const body:any=await req.json(),action=clean(body?.action,40).toLowerCase();if(action==='probe_customer'){const result=await probeAccurateCustomerByName(clean(body?.customerName,240));return Response.json({ok:true,action,result},{headers:{'cache-control':'no-store'}});}if(action==='prepare_sales_invoice'){const result=salesInvoicePreview(body);return Response.json({ok:true,action,result},{headers:{'cache-control':'no-store'}});}return Response.json({ok:false,error:'Aksi bridge belum diizinkan.'},{status:400,headers:{'cache-control':'no-store'}});}catch(e:any){return Response.json({ok:false,error:clean(e?.message||e,800)},{status:500,headers:{'cache-control':'no-store'}});}};
export const config:Config={path:'/api/hc-accurate-bridge'};
