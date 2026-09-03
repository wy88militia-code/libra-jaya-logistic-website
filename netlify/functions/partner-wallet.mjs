import { getUatRecord } from './_api-uat-core.mjs';
import { getWallet, listWalletTransactions, requirePartnerSession } from './_partner-core.mjs';

export default async (request) => {
  const partner = await requirePartnerSession(request);
  if (!partner) return Response.json({ message: 'Sesi partner tidak valid.' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const wallet = await getWallet(partner.partnerId);
  const transactions = await listWalletTransactions(partner.partnerId, 30);
  let depositPolicy={locked:false,reason:null,finalDecision:null,requiredDeposit:0,productionEnabled:false};
  if(partner.onboardingApplicationId){
    const uat=await getUatRecord(partner.partnerId);const finalDecision=String(uat?.finalDecision||'PENDING').toUpperCase();depositPolicy={locked:finalDecision!=='PASS',reason:finalDecision!=='PASS'?'Deposit partner API baru dibuka setelah UAT mendapat Final PASS dari Admin Libra.':null,finalDecision,requiredDeposit:Math.max(0,Number(uat?.requiredDeposit)||0),productionEnabled:Boolean(uat?.productionEnabled)};
  }
  return Response.json({
    partner: { partnerId: partner.partnerId, companyName: partner.companyName, picName: partner.picName, isApiPartner:Boolean(partner.onboardingApplicationId) },
    balance: wallet.balance,
    updatedAt: wallet.updatedAt,
    transactions,
    depositPolicy,
  }, { headers: { 'cache-control': 'no-store' } });
};

export const config = { path: '/.netlify/functions/partner-wallet', method: 'GET' };
