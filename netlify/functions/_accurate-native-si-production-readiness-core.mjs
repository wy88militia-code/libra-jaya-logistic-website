import { accurateConfigStatus, resolveAccurateConnection, validateAccurateBranch } from './_accurate-core.mjs';
import { buildPhase1NativeSiReadiness } from './_accurate-native-si-core.mjs';
import { getPhase1NativeSiUatState } from './_accurate-native-si-uat-core.mjs';
import { getPhase1NativeSiUatReadbackProof } from './_accurate-native-si-uat-readback-core.mjs';
import { getBooking } from './_booking-core.mjs';
import { phase1NativeSiWalletContract, verifyPhase1NativeSiWalletContract } from './_phase1-native-si-wallet-core.mjs';
import { buildPhase1SettlementReadiness } from './_phase1-native-si-settlement-core.mjs';

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const flag=name=>String(process.env[name]||'').trim().toLowerCase()==='true';
const databaseName=db=>clean(db?.alias||db?.name||db?.databaseName||db?.companyName||'',160);
const productionEnabled=()=>flag('ACCURATE_NATIVE_SI_PRODUCTION_ENABLED');
const productionArmed=()=>flag('ACCURATE_NATIVE_SI_PRODUCTION_ARMED');
const partnerSettlementEnabled=()=>flag('ACCURATE_NATIVE_SI_PARTNER_DEPOSIT_SETTLEMENT_ENABLED');
const directArEnabled=()=>flag('ACCURATE_NATIVE_SI_DIRECT_AR_ENABLED');

export async function buildPhase1NativeSiProductionReadiness(bookingId){
  const id=clean(bookingId,120);if(!id)throw new Error('Booking ID wajib.');
  const [booking,nativeReadiness,uat,uatReadback,settlementReadiness]=await Promise.all([getBooking(id),buildPhase1NativeSiReadiness(id),getPhase1NativeSiUatState(id),getPhase1NativeSiUatReadbackProof(id),buildPhase1SettlementReadiness(id)]);if(!booking)throw new Error('Booking tidak ditemukan.');
  const reasons=[];
  if(!nativeReadiness.ready)reasons.push({code:'NATIVE_SI_MAPPING_NOT_READY',message:`Native SI mapping/payload belum READY: ${(nativeReadiness.reasons||[]).map(x=>x.code).join(', ')||'unknown blocker'}.`});
  if(!uat||uat.status!=='EXECUTED'||uat.execution?.testOnly!==true)reasons.push({code:'NATIVE_SI_UAT_PROOF_REQUIRED',message:'Belum ada Native Sales Invoice UAT berstatus EXECUTED pada database TEST.'});
  if(uat?.status==='RECONCILE_REQUIRED')reasons.push({code:'NATIVE_SI_UAT_RECONCILE_REQUIRED',message:'UAT masih RECONCILE_REQUIRED. Cutover production diblokir sampai rekonsiliasi selesai.'});
  if(!uatReadback||uatReadback.status!=='VERIFIED')reasons.push({code:'NATIVE_SI_UAT_READBACK_CERT_REQUIRED',message:'UAT wajib lolos sertifikasi read-back: nomor, customer, cabang, item dan total harus identik.'});
  else if(uatReadback.draftFingerprint!==nativeReadiness.draftFingerprint)reasons.push({code:'NATIVE_SI_UAT_READBACK_STALE',message:'Sertifikat UAT berasal dari draft fingerprint lama. Jalankan UAT/read-back ulang untuk draft terbaru.'});
  const walletContract=verifyPhase1NativeSiWalletContract();if(!walletContract.ok)reasons.push({code:'LEGACY_JV_EXCLUSION_CONTRACT_FAILED',message:'Kontrak anti-double wallet → legacy auto-JV tidak valid.'});
  if(phase1NativeSiWalletContract().source==='BOOKING')reasons.push({code:'LEGACY_BOOKING_SOURCE_FORBIDDEN',message:'Native SI tidak boleh memakai wallet source BOOKING karena source itu diakui revenue oleh JV legacy.'});

  const customerMode=settlementReadiness.mode;
  if(customerMode==='PARTNER_DEPOSIT'&&!partnerSettlementEnabled())reasons.push({code:'PARTNER_SETTLEMENT_POLICY_NOT_ENABLED',message:'Policy settlement saldo partner belum diaktifkan.'});
  if(customerMode==='DIRECT_AR'&&!directArEnabled())reasons.push({code:'DIRECT_AR_POLICY_NOT_ENABLED',message:'Policy piutang/direct customer untuk Native SI belum diaktifkan.'});
  for(const row of settlementReadiness.reasons||[])reasons.push(row);

  const config=accurateConfigStatus();if(!config.configured)reasons.push({code:'ACCURATE_PRODUCTION_NOT_CONFIGURED',message:'Koneksi Accurate production belum dikonfigurasi.'});
  let actualDatabaseName=null,branch={ok:false,target:config.branchName||'JLX Cargo',found:null},connectionError=null;
  if(config.configured)try{const connection=await resolveAccurateConnection();actualDatabaseName=databaseName(connection.database);branch=await validateAccurateBranch(config.branchName);}catch(e){connectionError=clean(e?.message||e,600);reasons.push({code:'ACCURATE_PRODUCTION_READ_FAILED',message:connectionError});}
  const expected=clean(config.expectedProductionDatabaseName,160);if(config.configured&&!actualDatabaseName)reasons.push({code:'PRODUCTION_DATABASE_IDENTITY_UNVERIFIED',message:'Nama/alias database production tidak dapat dibuktikan dari koneksi Accurate. Native SI write diblokir.'});
  if(!expected)reasons.push({code:'PRODUCTION_DATABASE_EXPECTED_NAME_MISSING',message:'ACCURATE_PRODUCTION_DATABASE_NAME belum diset.'});else if(actualDatabaseName&&actualDatabaseName.toLowerCase()!==expected.toLowerCase())reasons.push({code:'PRODUCTION_DATABASE_MISMATCH',message:`Terhubung ke "${actualDatabaseName}", expected "${expected}".`});
  if(actualDatabaseName&&/(test|tes|uat|sandbox)/i.test(actualDatabaseName))reasons.push({code:'PRODUCTION_DATABASE_LOOKS_TEST',message:`Database production "${actualDatabaseName}" terdeteksi sebagai TEST/UAT/Sandbox.`});
  if(config.configured&&!branch.ok)reasons.push({code:'PRODUCTION_BRANCH_NOT_FOUND',message:`Cabang ${branch.target||'JLX Cargo'} tidak ditemukan di Accurate production.`});
  if(!productionEnabled())reasons.push({code:'NATIVE_SI_PRODUCTION_DISABLED',message:'ACCURATE_NATIVE_SI_PRODUCTION_ENABLED belum true.'});
  if(!productionArmed())reasons.push({code:'NATIVE_SI_PRODUCTION_NOT_ARMED',message:'ACCURATE_NATIVE_SI_PRODUCTION_ARMED belum true.'});

  const ready=reasons.length===0;
  return {
    bookingId:id,ready,status:ready?'READY_FOR_NATIVE_SI_PRODUCTION_EXECUTOR':'BLOCKED',reasons,customerMode,
    production:{nativeSiEnabled:productionEnabled(),nativeSiArmed:productionArmed(),actualDatabaseName,expectedDatabaseName:expected||null,branchName:config.branchName||'JLX Cargo',branchFound:Boolean(branch.ok),connectionError,postAvailable:ready&&customerMode==='DIRECT_AR',note:'Production executor hanya Direct AR. Partner Deposit tetap blocked sampai Sales Down Payment bridge tersedia.'},
    uatProof:uat?.status==='EXECUTED'?{requestId:uat.requestId,databaseName:uat.execution?.databaseName||uat.databaseName,accurateNumber:uat.execution?.accurateNumber||null,accurateId:uat.execution?.accurateId??null,executedAt:uat.execution?.executedAt||null,testOnly:Boolean(uat.execution?.testOnly),strictReadbackVerified:Boolean(uatReadback?.status==='VERIFIED'),strictReadbackChecks:uatReadback?.verification?.checks||null,strictReadbackAt:uatReadback?.verifiedAt||null}:null,
    nativePayload:{ready:nativeReadiness.ready,draftId:nativeReadiness.draftId,draftFingerprint:nativeReadiness.draftFingerprint,draftTotal:nativeReadiness.draftTotal,customerNo:nativeReadiness.payloadPreview?.customerNo||null,itemCount:nativeReadiness.payloadPreview?.detailItem?.length||0,taxPolicyConfirmed:Boolean(nativeReadiness.accurate?.taxPolicyConfirmed)},
    settlement:{...settlementReadiness,partnerSettlementEnabled:partnerSettlementEnabled(),directArEnabled:directArEnabled(),walletContract:walletContract.contract,legacyAutoStrategy:'Dedicated source PHASE1_NATIVE_SI_SETTLEMENT + IGNORED marker. Never source BOOKING for Native SI settlement.',accountingGuard:customerMode==='PARTNER_DEPOSIT'?'BLOCKED until Libra wallet deposit is represented by reconcilable Accurate Sales Down Payment; do not fake settlement with bank Sales Receipt.':'Direct AR becomes authoritative in Accurate after verified Native SI; no local wallet mutation.'},
    guard:'PRODUCTION_POST_MUST_USE_STRICT_MAKER_CHECKER_DUPLICATE_READBACK',checkedAt:new Date().toISOString(),
  };
}