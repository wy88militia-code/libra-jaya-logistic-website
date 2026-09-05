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
const norm=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function accurateAutoStatus(){
 const start=startAt(),startMs=new Date(start||0).getTime();
 return {enabled:autoEnabled(),postingEnabled:postingEnabled(),productionArmed:productionArmed(),startAt:start||null,startAtValid:Boolean(start&&Number.isFinite(startMs)),branchName:branchName(),mode:'FULL_AUTO_WALLET_EVENTS',reviewAt:'ACCURATE',duplicateGuard:true,readBackGuard:true};
}

function mapWalletTransaction(tx){
 const map=accountMap(),source=String(tx?.source||'').trim().toUpperCase(),signed=money(tx?.signedAmount),amount=Math.abs(signed),kind=String(tx?.metadata?.kind||'').trim().toUpperCase();
 if(!amount)return {ok:false,reason:'Nominal transaksi nol/tidak valid.'};
 if(source==='XENDIT'&&signed>0){
  if(!map.bankClearing||!map.customerDeposit)return {ok:false,reason:'Mapping Bank Clearing/Customer Deposit belum lengkap.'};
  return {ok:true,type:'TOPUP_XENDIT',entries:[{role:'BANK_CLEARING',accountNo:map.bankClearing,debit:amount,credit:0},{role:'CUSTOMER_DEPOSIT',accountNo:map.customerDeposit,debit:0,credit:amount}]};
 }
 if(source==='MANUAL_DEPOSIT'&&signed>0){
  const bankAccountNo=clean(tx?.metadata?.bankAccountNo,80);if(!bankAccountNo||!map.customerDeposit)return {ok:false,reason:'Deposit manual belum memiliki akun bank Accurate / mapping Customer Deposit.'};
  return {ok:true,type:'MANUAL_DEPOSIT',dynamicAccountNos:[bankAccountNo],entries:[{role:'BANK_ACCOUNT',accountNo:bankAccountNo,debit:amount,credit:0},{role:'CUSTOMER_DEPOSIT',accountNo:map.customerDeposit,debit:0,credit:amount}]};
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
 return {hash,job:{jobId,status:'APPROVAL_PENDING',partnerId:tx.partnerId,month:`AUTO-${date.isoMonth}`,statementNo:clean(tx.reference||tx.transactionId,120),statementHash:hash,journalNumber,journalDraft,createdAt:now(),createdBy:'SYSTEM_AUTO',updatedAt:now(),lastError:null,postedAt:null,accurateReference:null,accurateId:null,approvalRequestId,duplicate:false,autoEvent:true,autoSource:tx.source,walletTransactionId:tx.transactionId,accountantReviewAt:'ACCURATE',duplicateGuard:true,readBackGuard:true}};
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

async function validateDynamicAccounts(accurate,nos=[]){
 const wanted=[...new Set((nos||[]).map(v=>clean(v,80)).filter(Boolean))];if(!wanted.length)return {ok:true,found:[]};const rows=[];let page=1,pageCount=1;do{const {data}=await accurate.accurateGet('glaccount','list',{'sp.pageSize':100,'sp.page':page,'fields':'id,no,name,accountType'});const batch=Array.isArray(data?.d)?data.d:[];rows.push(...batch);pageCount=Math.max(1,Math.min(Number(data?.sp?.pageCount)||1,100));page+=1;}while(page<=pageCount);const byNo=new Map(rows.map(r=>[clean(r?.no,80),r]));const found=wanted.map(no=>({no,row:byNo.get(no)||null})),missing=found.filter(x=>!x.row).map(x=>x.no);return {ok:missing.length===0,found,missing};
}

function normalizeDate(value){
 const raw=clean(value,50);if(!raw)return '';
 if(/^\d{2}\/\d{2}\/20\d{2}$/.test(raw))return raw;
 const d=new Date(raw);if(!Number.isFinite(d.getTime()))return raw;
 return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jayapura',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
}

function expectedLines(payload){
 return (payload?.detailJournalVoucher||[]).map(line=>`${clean(line.accountNo,80)}|${String(line.amountType||'').toUpperCase()}|${Math.abs(money(line.amount))}`).sort();
}

function detailLines(detail){
 const source=Array.isArray(detail?.detailJournalVoucher)?detail.detailJournalVoucher:Array.isArray(detail?.detailJournal)?detail.detailJournal:Array.isArray(detail?.details)?detail.details:[];
 const rows=[];
 for(const line of source){
  const accountNo=clean(line?.accountNo||line?.glAccountNo||line?.account?.no||line?.glAccount?.no,80);if(!accountNo)continue;
  const amount=Math.abs(money(line?.amount)),type=String(line?.amountType||'').trim().toUpperCase();
  if(amount>0&&(type==='DEBIT'||type==='CREDIT')){rows.push(`${accountNo}|${type}|${amount}`);continue;}
  const debit=Math.abs(money(line?.debit??line?.debitAmount)),credit=Math.abs(money(line?.credit??line?.creditAmount));
  if(debit>0)rows.push(`${accountNo}|DEBIT|${debit}`);if(credit>0)rows.push(`${accountNo}|CREDIT|${credit}`);
 }
 return rows.sort();
}

function verifyJournalDetail(detail,payload,expectedBranchId=null){
 const actualNumber=clean(detail?.number||detail?.no,120),actualDate=normalizeDate(detail?.transDate||detail?.date),expectedDate=normalizeDate(payload?.transDate);
 const actualBranch=clean(detail?.branchName||detail?.branch?.name||detail?.branch?.branchName,160),actualBranchId=detail?.branchId??detail?.branch?.id??null;
 const expectedBranch=clean(payload?.branchName,160),branchOk=actualBranch?norm(actualBranch)===norm(expectedBranch):(expectedBranchId!==null&&expectedBranchId!==undefined&&actualBranchId!==null&&actualBranchId!==undefined?String(actualBranchId)===String(expectedBranchId):false);
 const expected=expectedLines(payload),actual=detailLines(detail),linesReadable=actual.length>0,linesOk=linesReadable&&expected.length===actual.length&&expected.every((v,i)=>v===actual[i]);
 const checks={number:actualNumber===clean(payload?.number,120),date:actualDate===expectedDate,branch:branchOk,lines:linesOk};
 return {verified:Object.values(checks).every(Boolean),checks,actual:{number:actualNumber,date:actualDate,branchName:actualBranch||null,branchId:actualBranchId,lines:actual},expected:{number:clean(payload?.number,120),date:expectedDate,branchName:expectedBranch,branchId:expectedBranchId,lines:expected}};
}

async function findJournalByNumber(accurate,number){
 const {data}=await accurate.accurateGet('journal-voucher','list',{'sp.pageSize':20,'sp.page':1,'fields':'id,number','filter.number':clean(number,120)}),rows=Array.isArray(data?.d)?data.d:[];
 const exact=rows.filter(row=>norm(row?.number||row?.no)===norm(number));
 if(exact.length>1)throw new Error(`Duplicate guard: lebih dari satu Journal Voucher bernomor ${clean(number,120)} ditemukan di Accurate.`);
 return exact[0]||null;
}

async function readJournalDetail(accurate,id){
 if(id===null||id===undefined||id==='')return null;
 const {data}=await accurate.accurateGet('journal-voucher','detail',{id});return data?.d&&typeof data.d==='object'?data.d:null;
}

async function lookupJournalVerification(accurate,payload,expectedBranchId=null,idHint=null){
 let row=null,detail=null;
 if(idHint!==null&&idHint!==undefined&&idHint!==''){
  try{detail=await readJournalDetail(accurate,idHint);}catch{}
 }
 if(!detail){row=await findJournalByNumber(accurate,payload.number);if(!row)return {found:false,verified:false,row:null,detail:null,verification:null};detail=await readJournalDetail(accurate,row.id);}
 if(!detail)return {found:Boolean(row||idHint),verified:false,row,detail:null,verification:null};
 const verification=verifyJournalDetail(detail,payload,expectedBranchId);return {found:true,verified:verification.verified,row,detail,verification};
}

async function updateAutoJob(job,patch){
 const key=autoJobKey(job.statementHash),entry=await syncStore().getWithMetadata(key,{type:'json',consistency:'strong'});if(!entry?.data)throw new Error('Auto job hilang saat update verification.');
 const next={...entry.data,...patch,updatedAt:now()},write=await syncStore().setJSON(key,next,{onlyIfMatch:entry.etag});if(write.modified)return next;
 const latest=await syncStore().get(key,{type:'json',consistency:'strong'});if(latest)return latest;throw new Error('Auto job berubah saat update verification.');
}

async function markExistingVerified(tx,job,lookup){
 const verifiedAt=now(),detail=lookup.detail||{},next=await updateAutoJob(job,{status:'POSTED',postedAt:job.postedAt||verifiedAt,accurateReference:clean(detail?.number||detail?.no||job.journalNumber,120),accurateId:detail?.id??lookup.row?.id??job.accurateId??null,duplicate:true,duplicateFoundBeforePost:true,readBackVerified:true,readBackVerifiedAt:verifiedAt,readBackDigest:digest(lookup.verification),lastError:null});
 return saveMarker(tx,'POSTED',{jobId:next.jobId,journalNumber:next.journalNumber,postedAt:next.postedAt,accurateId:next.accurateId??null,branchName:branchName(),duplicatePrevented:true,readBackVerified:true});
}

async function markReconcile(tx,job,reason,lookup=null){
 const next=await updateAutoJob(job,{status:'RECONCILE_REQUIRED',readBackVerified:false,readBackCheckedAt:now(),readBackDigest:lookup?.verification?digest(lookup.verification):null,lastError:clean(reason,500),failedAt:now()});
 return saveMarker(tx,'RECONCILE_REQUIRED',{jobId:next.jobId,journalNumber:next.journalNumber,reason:clean(reason,500),readBackVerified:false});
}

async function processTransaction(tx){
 const mapped=mapWalletTransaction(tx);if(!mapped.ok)return saveMarker(tx,'EXCEPTION',{reason:mapped.reason,unsupported:Boolean(mapped.unsupported)});
 let job=await ensureAutoJob(tx,mapped);
 if(job.status==='POSTED')return saveMarker(tx,'POSTED',{jobId:job.jobId,journalNumber:job.journalNumber,postedAt:job.postedAt,accurateId:job.accurateId??null,readBackVerified:Boolean(job.readBackVerified)});
 if(job.status==='RECONCILE_REQUIRED')return saveMarker(tx,'RECONCILE_REQUIRED',{jobId:job.jobId,journalNumber:job.journalNumber,reason:job.lastError||'Perlu reconcile.'});
 if(job.status==='POST_FAILED')return saveMarker(tx,'POST_FAILED',{jobId:job.jobId,journalNumber:job.journalNumber,reason:job.lastError||'Posting gagal.'});
 if(job.status!=='APPROVAL_PENDING')return saveMarker(tx,'EXCEPTION',{jobId:job.jobId,journalNumber:job.journalNumber,reason:`Status auto job ${job.status} tidak aman untuk auto-post.`});
 const accurate=await import('./_accurate-core.mjs'),payload=accurate.buildAccurateJournalPayload(job);
 try{
  const readiness=await accurate.verifyAccurateProductionReadiness();
  if(mapped.dynamicAccountNos?.length){const check=await validateDynamicAccounts(accurate,mapped.dynamicAccountNos);if(!check.ok)return saveMarker(tx,'EXCEPTION',{jobId:job.jobId,journalNumber:job.journalNumber,reason:`Akun dinamis Accurate tidak ditemukan: ${check.missing.join(', ')}. Posting diblokir.`});}
  const duplicate=await lookupJournalVerification(accurate,payload,readiness.branch.id,null);
  if(duplicate.found){
   if(duplicate.verified)return markExistingVerified(tx,job,duplicate);
   return markReconcile(tx,job,`Duplicate guard: nomor ${job.journalNumber} sudah ada di Accurate tetapi isi/tanggal/cabang tidak identik. Tidak ada POST baru.`,duplicate);
  }
  const posted=await accurate.postAccurateJob(job.jobId,'SYSTEM AUTO • review accountant in Accurate',job.approvalRequestId);
  let lookup;
  try{
   lookup=await lookupJournalVerification(accurate,payload,posted.productionBranchId??readiness.branch.id,posted.accurateId);
   if(!lookup.found){await wait(250);lookup=await lookupJournalVerification(accurate,payload,posted.productionBranchId??readiness.branch.id,posted.accurateId);}
  }catch(error){return markReconcile(tx,posted,`POST diterima tetapi read-back Accurate gagal: ${clean(error?.message||error,400)}`);}
  if(!lookup.found)return markReconcile(tx,posted,`POST diterima tetapi Journal Voucher ${job.journalNumber} belum dapat dibaca kembali dari Accurate.`);
  if(!lookup.verified)return markReconcile(tx,posted,`POST diterima tetapi read-back tidak identik untuk ${job.journalNumber}.`,lookup);
  const verifiedAt=now(),verified=await updateAutoJob(posted,{status:'POSTED',readBackVerified:true,readBackVerifiedAt:verifiedAt,readBackDigest:digest(lookup.verification),accurateId:lookup.detail?.id??posted.accurateId??null,accurateReference:clean(lookup.detail?.number||lookup.detail?.no||posted.accurateReference||job.journalNumber,120),lastError:null});
  return saveMarker(tx,'POSTED',{jobId:verified.jobId,journalNumber:verified.journalNumber,postedAt:verified.postedAt,accurateId:verified.accurateId??null,branchName:verified.productionBranchName||branchName(),readBackVerified:true});
 }catch(error){
  job=await accurate.getAccurateJob(job.jobId).catch(()=>job);
  if(job?.status==='RECONCILE_REQUIRED')return saveMarker(tx,'RECONCILE_REQUIRED',{jobId:job.jobId,journalNumber:job.journalNumber,reason:clean(job.lastError||error?.message||error,500)});
  if(job?.status==='POST_FAILED')return saveMarker(tx,'POST_FAILED',{jobId:job.jobId,journalNumber:job.journalNumber,reason:clean(job.lastError||error?.message||error,500)});
  const old=await loadMarker(tx.transactionId),attempts=Math.min(10,Number(old?.attempts||0)+1);return saveMarker(tx,'RETRY',{jobId:job?.jobId||null,journalNumber:job?.journalNumber||null,attempts,reason:clean(error?.message||error,500)});
 }
}

export async function reconcileAccurateAutoEvent(transactionId){
 const marker=await loadMarker(transactionId);if(!marker)throw new Error('Auto event tidak ditemukan.');
 if(marker.status==='POSTED')return {ok:true,status:'POSTED',alreadyVerified:Boolean(marker.readBackVerified),marker};
 if(marker.status!=='RECONCILE_REQUIRED')throw new Error(`Auto event harus RECONCILE_REQUIRED, sekarang ${marker.status||'-'}.`);
 const accurate=await import('./_accurate-core.mjs'),job=await accurate.getAccurateJob(marker.jobId);if(!job)throw new Error('Auto job reconcile tidak ditemukan.');
 const readiness=await accurate.verifyAccurateProductionReadiness(),payload=accurate.buildAccurateJournalPayload(job);
 let lookup;try{lookup=await lookupJournalVerification(accurate,payload,job.productionBranchId??readiness.branch.id,job.accurateId);}catch(error){const reason=`Verifikasi ulang read-back gagal: ${clean(error?.message||error,400)}`;await updateAutoJob(job,{status:'RECONCILE_REQUIRED',readBackCheckedAt:now(),lastError:reason});return {ok:false,status:'RECONCILE_REQUIRED',reason};}
 if(!lookup.found){const reason=`Journal Voucher ${job.journalNumber} belum ditemukan di Accurate. Tidak ada POST baru.`;await updateAutoJob(job,{status:'RECONCILE_REQUIRED',readBackCheckedAt:now(),lastError:reason});return {ok:false,status:'RECONCILE_REQUIRED',reason};}
 if(!lookup.verified){const failed=Object.entries(lookup.verification?.checks||{}).filter(([,v])=>!v).map(([k])=>k),reason=`Journal Voucher ditemukan tetapi read-back belum identik${failed.length?`: ${failed.join(', ')}`:''}. Tidak ada POST baru.`;await updateAutoJob(job,{status:'RECONCILE_REQUIRED',readBackCheckedAt:now(),readBackDigest:digest(lookup.verification),lastError:reason});return {ok:false,status:'RECONCILE_REQUIRED',reason,verification:lookup.verification};}
 const verifiedAt=now(),verified=await updateAutoJob(job,{status:'POSTED',postedAt:job.postedAt||verifiedAt,readBackVerified:true,readBackVerifiedAt:verifiedAt,readBackDigest:digest(lookup.verification),accurateId:lookup.detail?.id??job.accurateId??null,accurateReference:clean(lookup.detail?.number||lookup.detail?.no||job.accurateReference||job.journalNumber,120),lastError:null});
 const tx={transactionId:marker.transactionId,partnerId:marker.partnerId,source:marker.source,reference:marker.reference,signedAmount:marker.amount,createdAt:marker.createdAt};
 const saved=await saveMarker(tx,'POSTED',{jobId:verified.jobId,journalNumber:verified.journalNumber,postedAt:verified.postedAt||verifiedAt,accurateId:verified.accurateId??null,branchName:verified.productionBranchName||branchName(),duplicatePrevented:true,readBackVerified:true,readBackVerifiedAt:verifiedAt});
 return {ok:true,status:'POSTED',journalNumber:verified.journalNumber,verification:lookup.verification,marker:saved};
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
