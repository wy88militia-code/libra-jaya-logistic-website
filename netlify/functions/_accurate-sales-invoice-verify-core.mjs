import crypto from 'node:crypto';

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const money=v=>Number.isFinite(Number(v))?Math.round(Number(v)):null;
const norm=v=>clean(v,240).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
const qty=v=>Number.isFinite(Number(v))?Math.round(Number(v)*1000000)/1000000:null;
const price=v=>Number.isFinite(Number(v))?Math.round(Number(v)*1000000)/1000000:null;

export function deterministicPhase1SalesInvoiceNumber(bookingId,draftFingerprint){
  const digest=crypto.createHash('sha256').update(`${clean(bookingId,120)}|${clean(draftFingerprint,128)}`).digest('hex').slice(0,16).toUpperCase();
  return `JLX-P1-${digest}`;
}

export function extractAccurateSalesInvoiceTotal(detail={}){
  const candidates=[detail.totalAmount,detail.grandTotal,detail.invoiceAmount,detail.netAmount,detail.total,detail.primeOwing,detail.owingAmount];
  for(const value of candidates){const n=money(value);if(n!==null&&n>=0)return n;}
  return null;
}

function expectedItemTuple(row={}){return `${clean(row.itemNo,120)}|${qty(row.quantity??1)}|${price(row.unitPrice)}`;}
function actualItemTuple(row={}){return `${clean(row.itemNo||row.item?.no||row.item?.number,120)}|${qty(row.quantity??row.qty??1)}|${price(row.unitPrice??row.price??row.unitPriceBase)}`;}
function actualItems(detail={}){const source=Array.isArray(detail.detailItem)?detail.detailItem:Array.isArray(detail.details)?detail.details:Array.isArray(detail.detailItems)?detail.detailItems:[];return source.filter(x=>clean(x?.itemNo||x?.item?.no||x?.item?.number,120)).map(actualItemTuple).sort();}

export function verifyAccurateSalesInvoiceDetail(detail={},expected={}){
  const expectedNumber=clean(expected.number,120),expectedCustomerNo=clean(expected.customerNo,120),expectedBranch=clean(expected.branchName,160),expectedTotal=money(expected.total),expectedItems=(expected.detailItem||[]).map(expectedItemTuple).sort();
  const actualNumber=clean(detail.number||detail.no,120),actualCustomerNo=clean(detail.customerNo||detail.customer?.no||detail.customer?.number,120),actualBranch=clean(detail.branchName||detail.branch?.name,160),actualTotal=extractAccurateSalesInvoiceTotal(detail),items=actualItems(detail);
  const checks={
    number:Boolean(expectedNumber)&&actualNumber===expectedNumber,
    customer:Boolean(expectedCustomerNo)&&actualCustomerNo===expectedCustomerNo,
    branch:Boolean(expectedBranch)&&norm(actualBranch)===norm(expectedBranch),
    total:expectedTotal!==null&&actualTotal!==null&&actualTotal===expectedTotal,
    items:expectedItems.length>0&&items.length===expectedItems.length&&expectedItems.every((v,i)=>v===items[i]),
  };
  return {verified:Object.values(checks).every(Boolean),checks,actual:{number:actualNumber||null,customerNo:actualCustomerNo||null,branchName:actualBranch||null,total:actualTotal,items},expected:{number:expectedNumber||null,customerNo:expectedCustomerNo||null,branchName:expectedBranch||null,total:expectedTotal,items:expectedItems},totalReadable:actualTotal!==null,itemsReadable:items.length>0};
}
