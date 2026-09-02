import { mutateWallet, requirePartnerSession } from './_partner-core.mjs';

export default async (request) => {
  const partner = await requirePartnerSession(request);
  if (!partner) return Response.json({ message: 'Sesi partner tidak valid.' }, { status: 401 });
  if (request.method !== 'POST') return Response.json({ message: 'Metode tidak diizinkan.' }, { status: 405 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ message: 'Permintaan tidak valid.' }, { status: 400 }); }
  const bookingId = String(body?.bookingId || '').trim().slice(0, 80);
  const amount = Math.trunc(Number(body?.amount));
  if (!bookingId || !Number.isFinite(amount) || amount <= 0) return Response.json({ message: 'Booking ID dan nominal wajib valid.' }, { status: 400 });
  try {
    const result = await mutateWallet(partner.partnerId, -amount, `BOOKING:${bookingId}`, {
      source: 'BOOKING',
      description: `Pemotongan saldo booking ${bookingId}`,
      metadata: body?.metadata || null,
    });
    return Response.json({ ok: true, bookingId, amount, balance: result.balance, duplicate: result.duplicate, transactionId: result.transactionId });
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_BALANCE') {
      return Response.json({ ok: false, code: 'INSUFFICIENT_BALANCE', message: 'Saldo deposit tidak cukup. Top-up diperlukan sebelum booking diproses.', balance: error.balance }, { status: 402 });
    }
    return Response.json({ ok: false, code: error?.code || 'WALLET_ERROR', message: error?.message || 'Gagal memotong saldo.' }, { status: 409 });
  }
};

export const config = { path: '/.netlify/functions/partner-booking-debit', method: 'POST' };
