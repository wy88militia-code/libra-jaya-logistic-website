import { getPartner, issuePartnerSession, verifyPin } from './_partner-core.mjs';

export default async (request) => {
  if (request.method !== 'POST') return Response.json({ message: 'Metode tidak diizinkan.' }, { status: 405 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ message: 'Permintaan tidak valid.' }, { status: 400 }); }
  const partner = await getPartner(body?.partnerId);
  if (!partner || partner.status !== 'ACTIVE' || !verifyPin(body?.pin, partner)) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return Response.json({ message: 'Partner ID atau PIN salah.' }, { status: 401 });
  }
  return Response.json({ ok: true, partner: { partnerId: partner.partnerId, companyName: partner.companyName } }, {
    headers: { 'set-cookie': issuePartnerSession(partner.partnerId), 'cache-control': 'no-store' },
  });
};

export const config = {
  path: '/.netlify/functions/partner-login',
  method: 'POST',
  rateLimit: { windowSize: 300, windowLimit: 8, aggregateBy: 'ip', action: 'rate_limit' },
};
