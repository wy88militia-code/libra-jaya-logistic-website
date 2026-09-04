import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const SYNC_STORE='libra-accurate-sync';
const WALLET_STORE='libra-wallets';
const syncStore=()=>getStore(SYNC_STORE);
const walletStore=()=>getStore(WALLET_STORE);
const now=()=>new Date().toISOString();
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const money=v=>Math.trunc(Number(v)||0);
const flag=name=>String(process.env[name]||'').trim().toLowerCase()==='true';
const autoEnabled=()=>flag('ACCURATE_AUTO_POST_ENABLED');
const postingEnabled=()=>flag('ACCURATE_POSTING_ENABLED');
const productionArmed=()=>flag('ACCURATE_PRODUCTION_ARMED');
const branchName=()=>clean(process.env.ACCURATE_BRANCH_JLX||'JLX Cargo',160);
const startAt=()=>clean(process.env.ACCURATE_AUTO_POST_START_AT,80);
const accountMap=()=>({
 customerDeposit:clean(process.env.ACCURATE_ACCOUNT_CUSTOMER_DEPOSIT,80),
 serviceRevenue:clean(process.env.ACCURATE_ACCOUNT_SERVICE_REVENUE,80),
 claimExpense:clean(process.env.ACCURATE_ACCOUNT_CLAIM_EXPENSE,80),
 adjustmentExpense:clean(process.env.ACCURATE_ACCOUNT_ADJUSTMENT_EXPENSE,80),
 bankClearing:clean(process.env.ACCURATE_ACCOUNT_BANK_CLEARING,80),
});
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const markerKey=id=>`auto-event/${clean(id,120)}`;
const autoJobKey=hash=>`job/${hash}`;

export function accurateAutoStatus(){
 const start=startAt(),startMs=new Date(start||0).getTime();
 return {enabled:autoEnabled(),postingEnabled:postingEnabled(),productionArmed:productionArmed(),startAt:start||null,startAtValid:Boolean(start&&Number.isFinite(startMs)),branchName:branchName(),mode:'FULL_AUTO_WALLET_EVENTS',reviewAt:'ACCURATE'};
}

function mapWalletTransaction(tx){
 const map=accountMap(),source=String(tx?.source||'').trim().toUpperCase(),signed=money(tx?.signedAmount),amount=Math.abs(signed),kind=String(tx?.metadata?.kind||'').trim().toUpperCase();
 if(!amount)return {ok:false,reason:'Nominal transaksi nol/tidak valid.'};
 if(source==='XENDIT'&&signed>0){
  if(!map.bankClearing||!map.customerDeposit)return {ok:false,reason:'Mapping Bank Clearing/Customer Deposit belum lengkap.'};
  return {ok:true,type:'TOPUP_XENDIT',entries:[{role:'BANK_CLEARING',accountNo:map.bankClearing,debit:amount,credit:0},{role:'CUSTOMER_DEPOSIT',accountNo:map.customerDeposit,debit:0,credit:amount}]};
 }
 if(source==='BOOKING'&&signed<0){
  if(!map.customerDeposit||!map.serviceRevenue)return {ok:false,reason:'Mapping Customer Deposit/Service Revenue belum lengkap.'};
  return {ok:true,type:'BOOKING_REVENUE',entries:[{role:'CUSTOMER_DEPOSIT',accountNo:map.customerDeposit,debit:amount,credit:0},{role:'SERVICE_REVENUE',accountNo:map.serviceRevenue,debit:0,credit:amount}]};
 }
 if(source==='BILLING_ADJUSTMENT'){
  if(signed<0){
   if(!map.customerDeposit||!map.serviceRevenue)return {ok:false,reason:'Mapping Customer Deposit/Service Revenue belum lengkap.'};
   return {ok:true,type:'DEBIT_NOTE',entries:[{role:'CUSTOMER_DEPOSIT',accountNo:map.customerDeposit,debit:amount,credit:0},{role:'SERVICE_REVENUE',accountNo:map.serviceRevenue,debit:0,credit:amount}]};
  }
  if(kind==='CLAIM_SETTLEMENT'){
   if(!map.claimExpense||!map.customerDeposit)return {ok:false,reason:'Mapping Claim Expense/Customer Deposit belum lengkap.'};
   return {ok:true,type:'CLAIM_SETTLEMENT',entries:[{role:'CLAIM_EXPENSE',accountNo:map.claimExpense,debit:amount,credit:0},{role:'CUSTOMER_DEPOSIT',accountNo:map.customerDeposit,debit:0,credit:amount}]};
  }
  if(!map.adjustmentExpense||!map.customerDeposit)return {ok:false,reason:'Mapping Adjustment Expense/Customer Deposit belum lengkap.'};
  return {ok:true,type:kind||'CREDIT_ADJUSTMENT',entries:[{role:'ADJUSTMENT_EXPENSE',accountNo:map.adjustmentExpense,debit:amount,credit:0},{role:'CUSTOMER_DEPOSIT',accountNo:map.customerDeposit,debit:0,credit:amount}]};
 }
 return {ok:false,unsupported:true,reason:`Source ${source||'UNKNOWN'} bukan transaksi rutin auto-post. Masuk exception untuk review.`};
}

function witParts(value){
 const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).reduce((o,p)=>(o[p.type]=p.value,o),{});
 return {year:parts.year,month:parts.month,day:parts.day,isoMonth:`${parts.year}-${parts.month}`,compact:`${parts.year}${parts.month}${parts.day}`};
}

function makeAutoJob(tx,mapped){
 const date=witParts(tx.createdAt);if(!date)throw new Error('Tanggal transaksi wallet tidak valid.');
 const normalized={transactionId:tx.transactionId,partnerId:tx.partnerId,source:tx.source,signedAmount:money(tx.signedAmount),reference:tx.reference,createdAt:tx.createdAt,branchName:branchName(),type:mapped.type,entries:mapped.entries.map(x=>({accountNo:x.accountNo,debit:money(x.debit),credit:money(x.credit)}))};
 const hash=digest(normalized),short=hash.slice(0,10).toUpperCase(),jobId=`ACC-AUTO-${hash.slice(0,20).toUpperCase()}`,journalNumber=`LBR-AUTO-${date.compact}-${short}`,approvalRequestId=`AUTO-${hash.slice(0,18).toUpperCase()}`;
 const totalDebit=mapped.entries.reduce((s,x)=>s+money(x.debit),0),totalCredit=mapped.entries.reduce((s,x)=>s+money(x.credit),0);
 const description=clean(`AUTO ${mapped.type} • ${tx.partnerId} • ${tx.reference||tx.transactionId}`,250);
 const journalDraft={documentType:'JOURNAL_VOUCHER',source:'LIBRA_AUTO_WALLET_EVENT',statementNo:clean(tx.reference||tx.transactionId,120),partnerId:tx.partnerId,period:`AUTO-${date.isoMonth}`,transactionDate:tx.createdAt,branchName:branchName(),description,entries:mapped.entries,totalDebit,totalCredit,balanced:totalDebit===totalCredit&&totalDebit>0,mappingReady:mapped.entries.every(x=>Boolean(x.accountNo))};
 return {hash,job:{jobId,status:'APPROVAL_PENDING',partnerId:tx.partnerId,month:`AUTO-${date.isoMonth}`,statementNo:clean(tx.reference||tx.transactionId,120),statementHash:hash,journalNumber,journalDraft,createdAt:now(),createdBy:'SYSTEM_AUTO',updatedAt:now(),lastError:null,postedAt:null,accurateReference:null,accurateId:null,approvalRequestId,duplicate:false,autoEvent:true,autoSource:tx.source,walletTransactionId:tx.transactionId,accountantReviewAt:'ACCURATE'}};
}

async function loadMarker(transactionId){return syncStore().get(markerKey(transactionId),{type:'json',consistency:'strong'});}
async function saveMarker(tx,status,extra={}){const row={transactionId:tx.transactionId,partnerId:tx.partnerId,source:tx.source,reference:tx.reference||null,amount:Math.abs(money(tx.signedAmount)),status,createdAt:tx.createdAt,updatedAt:now(),...extra};await syncStore().setJSON(markerKey(tx.transactionId),row);return row;}

async function discoverTransactions(limit=60){
 const start=startAt(),startMs=new Date(start||0).getTime();if(!start||!Number.isFinite(startMs))return [];
 const {blobs}=await walletStore().list({prefix:'ledger/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,1000),rows=[];
 for(const blob of selected){const row=await walletStore().get(blob.key,{type:'json'});if(!row?.transactionId)continue;const t=new Date(row.createdAt||0).getTime();if(!Number.isFinite(t)||t<startMs)continue;const marker=await loadMarker(row.transactionId);if(marker&&['POSTED','RECONCILE_REQUIRED','POST_FAILED','EXCEPTION','IGNORED'].includes(marker.status))continue;rows.push(row);}
 return rows.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).slice(0,Math.max(1,Math.min(Number(limit)||60,100)));
}

async function ensureAutoJob(tx,mapped){
 const {hash,job}=makeAutoJob(tx,mapped),key=autoJobKey(hash),created=await syncStore().setJSON(key,job,{onlyIfNew:true});if(created.modified)return job;
 const existing=await syncStore().get(key,{type:'json',consistency:'strong'});if(!existing)throw new Error('Auto job sedang dibuat proses lain.');if(!existing.autoEvent||existing.walletTransactionId!==tx.transactionId)throw new Error('Collision pada Accurate auto job. Posting dihentikan.');return existing;
}

async function processTransaction(tx){
 const mapped=mapWalletTransaction(tx);if(!mapped.ok)return saveMarker(tx,'EXCEPTION',{reason:mapped.reason,unsupported:Boolean(mapped.unsupported)});
 let job=await ensureAutoJob(tx,mapped);
 if(job.status==='POSTED')return saveMarker(tx,'POSTED',{jobId:job.jobId,journalNumber:job.journalNumber,postedAt:job.postedAt,accurateId:job.accurateId??null});
 if(job.status==='RECONCILE_REQUIRED')return saveMarker(tx,'RECONCILE_REQUIRED',{jobId:job.jobId,journalNumber:job.journalNumber,reason:job.lastError||'Perlu reconcile.'});
 if(job.status==='POST_FAILED')return saveMarker(tx,'POST_FAILED',{jobId:job.jobId,journalNumber:job.journalNumber,reason:job.lastError||'Posting gagal.'});
 if(job.status!=='APPROVAL_PENDING')return saveMarker(tx,'EXCEPTION',{jobId:job.jobId,journalNumber:job.journalNumber,reason:`Status auto job ${job.status} tidak aman untuk auto-post.`});
 const accurate=await import('./_accurate-core.mjs');
 try{
  const posted=await accurate.postAccurateJob(job.jobId,'SYSTEM AUTO • review accountant in Accurate',job.approvalRequestId);
  return saveMarker(tx,'POSTED',{jobId:posted.jobId,journalNumber:posted.journalNumber,postedAt:posted.postedAt,accurateId:posted.accurateId??null,branchName:posted.productionBranchName||branchName()});
 }catch(error){
  job=await accurate.getAccurateJob(job.jobId).catch(()=>job);
  if(job?.status==='RECONCILE_REQUIRED')return saveMarker(tx,'RECONCILE_REQUIRED',{jobId:job.jobId,journalNumber:job.journalNumber,reason:clean(job.lastError||error?.message||error,500)});
  if(job?.status==='POST_FAILED')return saveMarker(tx,'POST_FAILED',{jobId:job.jobId,journalNumber:job.journalNumber,reason:clean(job.lastError||error?.message||error,500)});
  const old=await loadMarker(tx.transactionId),attempts=Math.min(10,Number(old?.attempts||0)+1);return saveMarker(tx,'RETRY',{jobId:job?.jobId||null,journalNumber:job?.journalNumber||null,attempts,reason:clean(error?.message||error,500)});
 }
}

export async function runAccurateAutoSync({limit=60}={}){
 const status=accurateAutoStatus();if(!status.enabled)return {ok:true,skipped:true,reason:'ACCURATE_AUTO_POST_ENABLED=false',status,processed:0};if(!status.startAtValid)return {ok:false,skipped:true,reason:'ACCURATE_AUTO_POST_START_AT belum valid.',status,processed:0};if(!status.postingEnabled||!status.productionArmed)return {ok:false,skipped:true,reason:'Dua kunci production belum aktif.',status,processed:0};
 const accurate=await import('./_accurate-core.mjs');
 try{await accurate.verifyAccurateProductionReadiness();}catch(error){return {ok:false,skipped:true,reason:clean(error?.message||error,500),status,processed:0};}
 const transactions=await discoverTransactions(limit),results=[];
 for(const tx of transactions){try{results.push(await processTransaction(tx));}catch(error){results.push(await saveMarker(tx,'RETRY',{attempts:1,reason:clean(error?.message||error,500)}));}}
 const counts=results.reduce((o,r)=>(o[r.status]=(o[r.status]||0)+1,o),{});return {ok:true,skipped:false,status,processed:results.length,counts,results:results.slice(-20),finishedAt:now()};
}

export async function listAccurateAutoEvents(limit=100){const {blobs}=await syncStore().list({prefix:'auto-event/'}),rows=[];for(const blob of blobs.slice(0,Math.max(1,Math.min(Number(limit)||100,500)))){const row=await syncStore().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows.sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));}
