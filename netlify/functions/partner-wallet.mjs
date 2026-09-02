import { getWallet, listWalletTransactions, requirePartnerSession } from './_partner-core.mjs';

export default async (request) => {
  const partner = await requirePartnerSession(request);
  if (!partner) return Response.json({ message: 'Sesi partner tidak valid.' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const wallet = await getWallet(partner.partnerId);
  const transactions = await listWalletTransactions(partner.partnerId, 30);
  return Response.json({
    partner: { partnerId: partner.partnerId, companyName: partner.companyName, picName: partner.picName },
    balance: wallet.balance,
    updatedAt: wallet.updatedAt,
    transactions,
  }, { headers: { 'cache-control': 'no-store' } });
};

export const config = { path: '/.netlify/functions/partner-wallet', method: 'GET' };
