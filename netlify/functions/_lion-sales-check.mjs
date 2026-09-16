import { accurateGet } from './_accurate-core.mjs';

const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const money=v=>Math.round((Number(v)||0)*100)/100;
function scalar(v){if(v==null)return '';if(['string','number','boolean'].includes(typeof v))return String(v);if(typeof v==='object')return clean(v.name??v.number??v.code??v.id,180);return '';}
function isoDate(v){const s=clean(v,40);let m=/^(20\d{2})-(\d{2})-(\d{2})/.exec(s);if(m)return `${m[1]}-${m[2]}-${m[3]}`;m=/^(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})/.exec(s);if(m)return `${m[3]}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;return null;}
function inPeriod(v,from,to){const d=isoDate(v);return Boolean(d&&d>=from&&d<=to);}
function amount(r){return money(r?.totalAmount??r?.grandTotal??r?.total??r?.amount??0);}
function branchValue(r){
  const direct=scalar(r?.branchName||r?.branch||r?.branchInfo||r?.branchData);
  if(direct)return direct;
  if(r&&typeof r==='object'){
    for(const [k,v] of Object.entries(r)){
      if(/^branch(Name)?$/i.test(k)){const x=scalar(v);if(x)return x;}
    }
  }
  return '';
}
async function invoiceList(){
  const attempts=[
    {'sp.pageSize':100,'sp.page':1,'sp.sort':'transDate|desc',fields:'id,number,transDate,totalAmount,customerName'},
    {'sp.pageSize':100,'sp.page':1,'sp.sort':'transDate|desc',fields:'id,number,transDate,totalAmount'},
    {'sp.pageSize':100,'sp.page':1,fields:'id,number,transDate,totalAmount'},
    {'sp.pageSize':100,'sp.page':1}
  ];
  let last='';
  for(const base of attempts){
    try{
      const rows=[];let page=1,pageCount=1;
      do{
        const params={...base,'sp.page':page};
        const {data}=await accurateGet('sales-invoice','list',params);
        rows.push(...(Array.isArray(data?.d)?data.d:[]));
        pageCount=Math.max(1,Math.min(Number(data?.sp?.pageCount)||1,100));
        page++;
      }while(page<=pageCount);
      return rows;
    }catch(e){last=clean(e?.message||e,600);}
  }
  throw new Error('Daftar Faktur Penjualan Accurate gagal dibaca. '+last);
}
async function invoiceDetail(id){const {data}=await accurateGet('sales-invoice','detail',{id});return data?.d??data??{};}

export async function checkLionSales({dateFrom,dateTo}){
  const from=isoDate(dateFrom),to=isoDate(dateTo);
  if(!from||!to||from>to)throw new Error('Periode faktur tidak valid.');
  const all=await invoiceList();
  const period=all.filter(r=>r?.id&&inPeriod(r.transDate||r.date,from,to)).slice(0,1000);
  const invoices=[],review=[];let detailFailures=0,otherBranches=0;
  for(let p=0;p<period.length;p+=4){
    const batch=period.slice(p,p+4);
    const got=await Promise.all(batch.map(async listRow=>{
      try{
        const d=await invoiceDetail(listRow.id),branchName=branchValue(d);
        return {id:d?.id??listRow.id,number:d?.number??listRow.number,date:isoDate(d?.transDate||d?.date||listRow.transDate),customerName:scalar(d?.customerName||d?.customer||listRow.customerName)||null,branchName:branchName||null,total:amount(d)||amount(listRow),detailOk:true};
      }catch(e){
        return {id:listRow.id,number:listRow.number,date:isoDate(listRow.transDate||listRow.date),customerName:scalar(listRow.customerName)||null,branchName:null,total:amount(listRow),detailOk:false,detailError:clean(e?.message||e,240)};
      }
    }));
    for(const i of got){
      if(!i.detailOk){detailFailures++;review.push({...i,routingStatus:'PERLU REVIEW AKUNTAN',reason:'Detail faktur Accurate gagal dibaca'});continue;}
      if(!i.branchName){review.push({...i,routingStatus:'PERLU REVIEW AKUNTAN',reason:'Cabang faktur kosong/tidak terbaca'});continue;}
      if(/lion\s*parcel/i.test(i.branchName))invoices.push({...i,routingStatus:'LION_PARCEL_BY_BRANCH'});else otherBranches++;
    }
  }
  return {scope:'LION_PARCEL',routingKey:'BRANCH',readOnly:true,dateFrom:from,dateTo:to,summary:{invoiceListRead:all.length,invoiceDetailsChecked:period.length,matched:invoices.length,otherBranches,needsReview:review.length,detailFailures,totalSales:money(invoices.reduce((s,i)=>s+i.total,0))},invoices,review};
}
