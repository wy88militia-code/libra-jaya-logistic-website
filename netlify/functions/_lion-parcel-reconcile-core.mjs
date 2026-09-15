import { getStore } from '@netlify/blobs';
import { accurateGet } from './_accurate-core.mjs';

const STORE_NAME='libra-bank-statements';
const store=()=>getStore(STORE_NAME);
const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const money=value=>Math.round((Number(value)||0)*100)/100;
const now=()=>new Date().toISOString();

function isoDate(value){
  const raw=clean(value,30);
  let match=/^(20\d{2})-(\d{2})-(\d{2})/.exec(raw);
  if(match)return match[1]+'-'+match[2]+'-'+match[3];
  match=/^(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})/.exec(raw);
  if(match)return match[3]+'-'+String(Number(match[2])).padStart(2,'0')+'-'+String(Number(match[1])).padStart(2,'0');
  const parsed=new Date(raw);return Number.isFinite(parsed.getTime())?parsed.toISOString().slice(0,10):null;
}
function dayNumber(value){const date=isoDate(value);return date?Math.floor(new Date(date+'T00:00:00Z').getTime()/86400000):null;}
function dayDistance(left,right){const a=dayNumber(left),b=dayNumber(right);return a===null||b===null?999:Math.abs(a-b);}
function rowAmount(row){return money(row?.totalAmount??row?.amount??row?.paymentAmount??row?.grandTotal??0);}
function invoiceView(row){
  return {id:clean(row?.id,100),number:clean(row?.number||row?.invoiceNo,120)||null,date:isoDate(row?.transDate||row?.date),amount:rowAmount(row),customerName:clean(row?.customerName||row?.customer?.name||row?.customer,180)||null,owing:row?.owing===undefined&&row?.owingAmount===undefined?null:money(row?.owing??row?.owingAmount)};
}
function receiptView(row){
  return {id:clean(row?.id,100),number:clean(row?.number||row?.receiptNo,120)||null,date:isoDate(row?.transDate||row?.date),amount:rowAmount(row),customerName:clean(row?.customerName||row?.customer?.name||row?.customer,180)||null};
}
async function fetchAll(resource,fieldOptions){
  let lastError=null;
  for(const fields of fieldOptions){
    try{
      const rows=[];let page=1,pageCount=1;
      do{
        const {data}=await accurateGet(resource,'list',{'sp.pageSize':100,'sp.page':page,'sp.sort':'transDate|desc',fields});
        rows.push(...(Array.isArray(data?.d)?data.d:[]));
        pageCount=Math.max(1,Math.min(Number(data?.sp?.pageCount)||1,20));page+=1;
      }while(page<=pageCount);
      return {ok:true,rows,error:null,fields,pages:pageCount};
    }catch(error){lastError=clean(error?.message||error,500);}
  }
  return {ok:false,rows:[],error:lastError||('Gagal membaca '+resource),fields:null,pages:0};
}
function publicCandidate(row){return {id:row.id||null,number:row.number||null,date:row.date||null,amount:row.amount,customerName:row.customerName||null,owing:row.owing??null};}
function combinations(rows,target){
  const hits=[],limited=rows.filter(x=>x.amount>0&&x.amount<target).slice(0,30);
  for(let i=0;i<limited.length;i++)for(let j=i+1;j<limited.length;j++){
    if(Math.abs(limited[i].amount+limited[j].amount-target)<=1)hits.push([limited[i],limited[j]]);
    if(hits.length>3)return hits;
    for(let k=j+1;k<limited.length;k++){if(Math.abs(limited[i].amount+limited[j].amount+limited[k].amount-target)<=1)hits.push([limited[i],limited[j],limited[k]]);if(hits.length>3)return hits;}
  }
  return hits;
}
function matchCredit(tx,invoices,receipts,usedInvoices,receiptSourceOk){
  const exactAll=invoices.filter(inv=>Math.abs(inv.amount-tx.credit)<=1&&dayDistance(inv.date,tx.date)<=2);
  const exact=exactAll.filter(inv=>!usedInvoices.has(inv.id));
  const receiptMatches=receipts.filter(row=>Math.abs(row.amount-tx.credit)<=1&&dayDistance(row.date,tx.date)<=2);
  const base={bankRow:tx.row,date:tx.date,amount:tx.credit,description:tx.description,reference:tx.reference||null,payerNameAvailable:Boolean(clean(tx.payerName||tx.counterparty))&&!/\[REDACTED_PERSON\]/i.test(clean(tx.payerName||tx.counterparty)),receiptCandidates:receiptMatches.slice(0,5).map(publicCandidate)};
  if(exact.length===1){
    const invoice=exact[0];usedInvoices.add(invoice.id);
    const days=dayDistance(invoice.date,tx.date),receiptExists=receiptMatches.length===1;
    const status=receiptExists?'MATCHED_RECEIPT_CANDIDATE':receiptSourceOk?'INVOICE_FOUND_PAYMENT_MISSING':'INVOICE_MATCH_RECEIPT_UNVERIFIED';
    const invoiceReason=days===0?'Nominal dan tanggal tepat; hanya satu faktur kandidat.':'Nominal tepat; tanggal berjarak '+days+' hari; hanya satu faktur kandidat.';
    const receiptReason=receiptExists?' Kandidat Penerimaan Penjualan juga ditemukan.':receiptSourceOk?' Penerimaan Penjualan belum ditemukan dan wajib diperiksa akuntan.':' Data Penerimaan Penjualan tidak tersedia, sehingga status pembayaran belum dapat dipastikan.';
    return {...base,status,confidence:days===0?0.92:days===1?0.84:0.76,needsReview:days>0||!receiptExists,reason:invoiceReason+receiptReason,invoiceCandidates:[publicCandidate(invoice)]};
  }
  if(exact.length>1)return {...base,status:'AMBIGUOUS_REVIEW',confidence:0.45,needsReview:true,reason:'Nominal dan tanggal cocok dengan beberapa faktur. Agent tidak memilih otomatis.',invoiceCandidates:exact.slice(0,8).map(publicCandidate)};
  if(exactAll.length&&!exact.length)return {...base,status:'DUPLICATE_CANDIDATE',confidence:0.35,needsReview:true,reason:'Faktur kandidat sudah dipakai oleh mutasi bank lain.',invoiceCandidates:exactAll.slice(0,8).map(publicCandidate)};
  const nearby=invoices.filter(inv=>!usedInvoices.has(inv.id)&&dayDistance(inv.date,tx.date)<=2);
  const groups=combinations(nearby,tx.credit);
  if(groups.length===1){for(const inv of groups[0])usedInvoices.add(inv.id);return {...base,status:'MULTI_INVOICE_REVIEW',confidence:0.72,needsReview:true,reason:'Satu kredit sama dengan gabungan '+groups[0].length+' faktur. Wajib dikonfirmasi akuntan.',invoiceCandidates:groups[0].map(publicCandidate)};}
  if(groups.length>1)return {...base,status:'AMBIGUOUS_REVIEW',confidence:0.4,needsReview:true,reason:'Ada beberapa kombinasi faktur dengan jumlah yang sama.',invoiceCandidates:groups.slice(0,3).flat().slice(0,8).map(publicCandidate)};
  const larger=nearby.filter(inv=>inv.amount>tx.credit).sort((a,b)=>a.amount-b.amount);
  if(larger.length===1)return {...base,status:'PARTIAL_PAYMENT',confidence:0.6,needsReview:true,reason:'Kredit lebih kecil daripada satu faktur terdekat; kemungkinan pembayaran sebagian.',invoiceCandidates:[publicCandidate(larger[0])]};
  const smaller=nearby.filter(inv=>inv.amount<tx.credit).sort((a,b)=>b.amount-a.amount);
  if(smaller.length===1)return {...base,status:'OVERPAYMENT_OR_DEPOSIT',confidence:0.5,needsReview:true,reason:'Kredit lebih besar daripada satu faktur terdekat; periksa lebih bayar atau deposit.',invoiceCandidates:[publicCandidate(smaller[0])]};
  if(receiptMatches.length)return {...base,status:'RECEIPT_FOUND_NO_INVOICE_MATCH',confidence:0.55,needsReview:true,reason:'Penerimaan Penjualan bernominal sama ditemukan, tetapi faktur pasangan belum unik.',invoiceCandidates:[]};
  return {...base,status:'UNMATCHED',confidence:0.2,needsReview:true,reason:'Tidak ditemukan faktur dengan nominal dan tanggal yang memenuhi aturan.',invoiceCandidates:[]};
}
function summary(rows){
  const counts={};for(const row of rows)counts[row.status]=(counts[row.status]||0)+1;
  return {creditTransactionCount:rows.length,totalCredit:money(rows.reduce((sum,row)=>sum+row.amount,0)),matchedHigh:rows.filter(x=>x.status==='MATCHED_RECEIPT_CANDIDATE'&&x.confidence>=0.9).length,invoiceFoundPaymentMissing:counts.INVOICE_FOUND_PAYMENT_MISSING||0,ambiguous:rows.filter(x=>/AMBIGUOUS|MULTI_INVOICE|PARTIAL|OVERPAYMENT|DUPLICATE|RECEIPT_FOUND/.test(x.status)).length,unmatched:counts.UNMATCHED||0,needsReview:rows.filter(x=>x.needsReview).length,statusCounts:counts};
}
export async function reconcileLionParcelStatement({statementId,session}){
  const id=clean(statementId,100);if(!id)throw new Error('Statement ID wajib diisi.');
  const key='statement/'+id,entry=await store().getWithMetadata(key,{type:'json',consistency:'strong'}),record=entry?.data;
  if(!record)throw new Error('Rekening koran tidak ditemukan.');
  if(record.status!=='CONFIRMED')throw new Error('Konfirmasi hasil pembacaan rekening koran sebelum rekonsiliasi.');
  const [invoiceResult,receiptResult]=await Promise.all([
    fetchAll('sales-invoice',['id,number,transDate,totalAmount,customerName,owing','id,number,transDate,totalAmount,customerName','id,number,transDate,totalAmount']),
    fetchAll('sales-receipt',['id,number,transDate,totalAmount,customerName','id,number,transDate,totalAmount'])
  ]);
  if(!invoiceResult.ok)throw new Error('Faktur Penjualan Accurate tidak dapat dibaca: '+invoiceResult.error);
  const transactions=Array.isArray(record.analysis?.transactions)?record.analysis.transactions:[],credits=transactions.filter(row=>Number(row.credit)>0&&row.date);
  const minDay=Math.min(...credits.map(row=>dayNumber(row.date)).filter(Number.isFinite)),maxDay=Math.max(...credits.map(row=>dayNumber(row.date)).filter(Number.isFinite));
  const invoices=invoiceResult.rows.map(invoiceView).filter(row=>row.id&&row.amount>0&&(!Number.isFinite(minDay)||dayNumber(row.date)>=minDay-2&&dayNumber(row.date)<=maxDay+2));
  const receipts=receiptResult.rows.map(receiptView).filter(row=>row.id&&row.amount>0&&(!Number.isFinite(minDay)||dayNumber(row.date)>=minDay-2&&dayNumber(row.date)<=maxDay+2));
  const usedInvoices=new Set(),rows=credits.map(tx=>matchCredit(tx,invoices,receipts,usedInvoices,receiptResult.ok));
  const reconciliation={scope:'LION_PARCEL_SALES_RECEIPTS',method:'DETERMINISTIC_DATE_AMOUNT_V1',readOnly:true,generatedAt:now(),generatedBy:clean(session.username,100),dateToleranceDays:2,nameRequired:false,invoiceSource:{ok:true,rowsRead:invoiceResult.rows.length,periodCandidates:invoices.length,fields:invoiceResult.fields},receiptSource:{ok:receiptResult.ok,rowsRead:receiptResult.rows.length,periodCandidates:receipts.length,fields:receiptResult.fields,error:receiptResult.error},summary:summary(rows),rows};
  const next={...record,reconciliation,reconciliationStatus:'REVIEW_REQUIRED',updatedAt:now()};
  const write=await store().setJSON(key,next,{onlyIfMatch:entry.etag});if(!write.modified)throw new Error('Data berubah saat rekonsiliasi. Muat ulang lalu coba lagi.');
  const publicRecord={...next};delete publicRecord.rawKeys;delete publicRecord.reviewNote;return publicRecord;
}
