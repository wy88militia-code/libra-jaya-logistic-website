import { accurateConfigStatus, accurateGet, validateAccurateBranch } from './_accurate-core.mjs';
import { getPhase1AccurateMappings } from './_accurate-phase1-mapping-core.mjs';
import { getBooking } from './_booking-core.mjs';
import { getPhase1InvoiceDraft } from './_phase1-invoice-draft-core.mjs';

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const money=v=>Math.max(0,Math.round(Number(v)||0));
const norm=v=>clean(v,240).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const flag=name=>String(process.env[name]||'').trim().toLowerCase()==='true';
const postingEnabled=()=>flag('ACCURATE_POSTING_ENABLED');
const uatWriteEnabled=()=>flag('ACCURATE_NATIVE_SI_UAT_WRITE_ENABLED');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const ITEM_ENV_BY_CODE=Object.freeze({
  PTP_CGK_DJJ:'ACCURATE_PHASE1_ITEM_PTP_CGK_DJJ',
  DJJ_LASTMILE_V1:'ACCURATE_PHASE1_ITEM_DJJ_LASTMILE',
  INSURANCE:'ACCURATE_PHASE1_ITEM_INSURANCE',
});

function idDate(v=new Date()){const d=new Date(v);if(Number.isNaN(d.getTime()))return null;return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;}
function responseRows(data){return Array.isArray(data?.d)?data.d:Array.isArray(data?.d?.data)?data.d.data:[];}
async function readPaged(resource,fields,maxPages=10){const rows=[];let page=1,pageCount=1;do{const {data}=await accurateGet(resource,'list',{'sp.pageSize':100,'sp.page':page,fields});rows.push(...responseRows(data));pageCount=Math.max(1,Math.min(Number(data?.sp?.pageCount)||1,maxPages));page+=1;if(page<=pageCount)await sleep(140);}while(page<=pageCount);return rows;}
function uniqueByNo(rows=[]){const map=new Map();for(const r of rows){const no=clean(r?.no||r?.number,120);if(no&&!map.has(no))map.set(no,r);}return [...map.values()];}
function customerCandidates(payer,customers){const exactName=norm(payer?.name),partnerId=norm(payer?.partnerId);return customers.filter(x=>{const n=norm(x?.name),no=norm(x?.no);return Boolean(exactName&&(n===exactName||no===exactName)||partnerId&&(no===partnerId||n===partnerId));}).slice(0,10);}
function optionFilter(rows,query,limit=250){const q=norm(query);const sorted=[...rows].sort((a,b)=>`${clean(a?.name)} ${clean(a?.no)}`.localeCompare(`${clean(b?.name)} ${clean(b?.no)}`,'id'));return sorted.filter(x=>!q||norm(`${x?.no||''} ${x?.name||''}`).includes(q)).slice(0,limit).map(x=>({id:x?.id??null,no:clean(x?.no,120),name:clean(x?.name,240)}));}
function itemMapping(lines,items,savedItems={}){const byNo=new Map(items.map(x=>[clean(x?.no,120),x])),result=[];for(const line of lines||[]){const code=upper(line.code),saved=savedItems?.[code]||null,envName=ITEM_ENV_BY_CODE[code]||`ACCURATE_PHASE1_ITEM_${code.replace(/[^A-Z0-9]+/g,'_')}`,envNo=clean(process.env[envName],120),configuredNo=clean(saved?.itemNo||envNo,120),source=saved?.itemNo?'SAVED_MAPPING':envNo?'ENV_FALLBACK':'UNMAPPED',item=configuredNo?byNo.get(configuredNo)||null:null;result.push({lineCode:code,envName,mappingSource:source,configuredNo:configuredNo||null,itemFound:Boolean(item),item:item?{id:item.id??null,no:clean(item.no,120),name:clean(item.name,240)}:null,savedMapping:saved||null});}return result;}

export async function buildPhase1NativeSiReadiness(bookingId,input={}){
  const id=clean(bookingId,120);if(!id)throw new Error('Booking ID wajib.');
  const [booking,draft]=await Promise.all([getBooking(id),getPhase1InvoiceDraft(id)]);if(!booking)throw new Error('Booking tidak ditemukan.');if(!draft)throw new Error('Draft invoice Tahap 1 belum tersedia.');
  const lineCodes=(draft.lines||[]).map(x=>upper(x.code)).filter(Boolean),mapping=await getPhase1AccurateMappings({bookingId:id,payer:draft.payer,lineCodes});
  const reasons=[];if(String(booking.billingStatus||'').toUpperCase()!=='FINANCE_REVIEWED_WAIT_NATIVE_SI')reasons.push({code:'FINANCE_REVIEW_REQUIRED',message:`Billing status ${booking.billingStatus||'-'} belum FINANCE_REVIEWED_WAIT_NATIVE_SI.`});
  if(draft.accurateStatus!=='NOT_POSTED')reasons.push({code:'DRAFT_ACCURATE_STATUS_INVALID',message:`Draft Accurate status ${draft.accurateStatus||'-'} bukan NOT_POSTED.`});
  const taxPolicyConfirmed=mapping.taxPolicy?Boolean(mapping.taxPolicy.confirmed):flag('ACCURATE_PHASE1_TAX_POLICY_CONFIRMED');if(!taxPolicyConfirmed)reasons.push({code:'ACCURATE_TAX_POLICY_REVIEW_REQUIRED',message:'Tax policy Native SI Tahap 1 belum dikonfirmasi. Finance harus memverifikasi perlakuan pajak master item/jasa Accurate sebelum UAT.'});
  const config=accurateConfigStatus();if(!config.configured)reasons.push({code:'ACCURATE_NOT_CONFIGURED',message:'Koneksi Accurate belum dikonfigurasi.'});
  let branch={ok:false,target:config.branchName||'JLX Cargo',found:null},customers=[],items=[],readError=null;
  if(config.configured)try{branch=await validateAccurateBranch(config.branchName);customers=await readPaged('customer','id,no,name',10);items=await readPaged('item','id,no,name',10);}catch(e){readError=clean(e?.message||e,500);reasons.push({code:'ACCURATE_MASTER_READ_FAILED',message:readError});}
  if(config.configured&&!branch.ok)reasons.push({code:'ACCURATE_BRANCH_NOT_FOUND',message:`Cabang ${branch.target||'JLX Cargo'} tidak ditemukan.`});
  customers=uniqueByNo(customers);items=uniqueByNo(items);const customerByNo=new Map(customers.map(x=>[clean(x?.no,120),x]));
  const candidates=customerCandidates(draft.payer,customers),savedCustomerNo=clean(mapping.customer?.customerNo,120),savedCustomer=savedCustomerNo?customerByNo.get(savedCustomerNo)||null:null;
  let customer=null,customerSource='UNMAPPED';if(savedCustomer){customer=savedCustomer;customerSource='SAVED_MAPPING';}else if(savedCustomerNo){reasons.push({code:'ACCURATE_CUSTOMER_MAPPING_STALE',message:`Mapping customerNo ${savedCustomerNo} tidak ditemukan lagi di master Accurate.`});customerSource='STALE_MAPPING';}else if(candidates.length===1){customer=candidates[0];customerSource='EXACT_AUTO_MATCH';}
  if(!readError&&!customer&&!savedCustomerNo)reasons.push({code:candidates.length>1?'ACCURATE_CUSTOMER_AMBIGUOUS':'ACCURATE_CUSTOMER_NOT_MAPPED',message:candidates.length>1?`Ditemukan ${candidates.length} customer Accurate yang cocok; pilih mapping eksplisit.`:`Customer Accurate untuk ${draft.payer?.name||draft.payer?.partnerId||'payer'} belum dipetakan.`});
  const mappings=itemMapping(draft.lines,items,mapping.items);for(const m of mappings)if(!m.configuredNo)reasons.push({code:'ACCURATE_ITEM_MAPPING_MISSING',message:`${m.lineCode}: pilih item/jasa Accurate dari panel mapping.`});else if(!m.itemFound)reasons.push({code:'ACCURATE_ITEM_NOT_FOUND',message:`${m.lineCode}: itemNo ${m.configuredNo} tidak ditemukan di Accurate.`});
  const lineMap=new Map(mappings.map(x=>[x.lineCode,x])),detailItem=[];for(const line of draft.lines||[]){const m=lineMap.get(upper(line.code));if(!m?.itemFound)continue;detailItem.push({itemNo:m.configuredNo,unitPrice:money(line.rate),quantity:Number(line.qty||1),detailName:clean(line.description,240),detailNotes:`Libra ${draft.bookingId} • ${line.code}`});}
  const payload=customer&&detailItem.length===(draft.lines||[]).length&&branch.ok?{customerNo:clean(customer.no,120),branchName:branch.target||'JLX Cargo',transDate:idDate(draft.createdAt||new Date()),currencyCode:'IDR',description:`JL Express Phase 1 ${draft.bookingId} • ${draft.serviceCode||''} • ${draft.routeCode||''}`.trim(),detailDownPayment:[],detailExpense:[],detailItem}:null;
  const payloadTotal=payload?payload.detailItem.reduce((s,x)=>s+money(Number(x.unitPrice)*Number(x.quantity)),0):null;if(payload&&payloadTotal!==money(draft.total))reasons.push({code:'ACCURATE_PAYLOAD_TOTAL_MISMATCH',message:`Payload preview Rp${money(payloadTotal).toLocaleString('id-ID')} tidak sama dengan draft Rp${money(draft.total).toLocaleString('id-ID')}.`});
  const productionPostingOn=postingEnabled(),uatWriteOn=uatWriteEnabled();
  return {bookingId:id,draftId:draft.draftId,draftFingerprint:draft.fingerprint,draftTotal:money(draft.total),payer:draft.payer,ready:reasons.length===0&&Boolean(payload)&&payloadTotal===money(draft.total),reasons,accurate:{configured:config.configured,branchName:config.branchName,branchFound:Boolean(branch.ok),authMode:config.authMode,productionPostingEnabled:productionPostingOn,nativeSiUatWriteEnabled:uatWriteOn,nativeSiWriteAllowed:false,nativeSiWriteReason:'Readiness/mapping tidak melakukan POST. Executor UAT memakai credential database TEST terpisah.',requiredScope:'sales_invoice_save',endpoint:'/accurate/api/sales-invoice/save.do',taxPolicyConfirmed,taxPolicy:mapping.taxPolicy||null,taxPolicyMode:mapping.taxPolicy?.mode||'REVIEW_REQUIRED'},customerResolution:{mappingKey:mapping.payerKey,mappingSource:customerSource,savedMapping:mapping.customer||null,matched:customer?{id:customer.id??null,no:clean(customer.no,120),name:clean(customer.name,240)}:null,candidates:candidates.map(x=>({id:x.id??null,no:clean(x.no,120),name:clean(x.name,240)})),totalCustomersRead:customers.length},itemMappings:mappings,totalItemsRead:items.length,masterOptions:{customers:optionFilter(customers,input.customerSearch,250),items:optionFilter(items,input.itemSearch,300)},payloadPreview:payload,payloadTotal,guard:'READ_ONLY_NO_POST'};
}
