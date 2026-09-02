import crypto from 'node:crypto';
import { getTopup, mutateWallet, saveTopup } from './_partner-core.mjs';

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const expectedToken = process.env.XENDIT_WEBHOOK_TOKEN;
  const suppliedToken = request.headers.get('x-callback-token') || '';
  if (!expectedToken || !safeEqual(suppliedToken, expectedToken)) return new Response('Unauthorized', { status: 401 });

  let event;
  try { event = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  if (event?.event !== 'payment_session.completed') return new Response('Ignored', { status: 200 });

  const data = event?.data || {};
  const referenceId = String(data.reference_id || '').trim();
  const paymentId = String(data.payment_id || data.payment_request_id || data.payment_session_id || '').trim();
  if (!referenceId || !paymentId || data.status !== 'COMPLETED') return new Response('Ignored', { status: 200 });

  const entry = await getTopup(referenceId, true);
  if (!entry?.data) return new Response('Topup not found', { status: 404 });
  const topup = entry.data;
  const paidAmount = Math.trunc(Number(data.amount));
  if (topup.paymentSessionId !== data.payment_session_id || paidAmount !== Math.trunc(Number(topup.amount))) {
    return new Response('Payment mismatch', { status: 409 });
  }

  const creditRef = `XENDIT:${paymentId}`;
  const credit = await mutateWallet(topup.partnerId, paidAmount, creditRef, {
    source: 'XENDIT',
    description: `Top-up deposit ${referenceId}`,
    metadata: { referenceId, paymentId, paymentSessionId: data.payment_session_id },
  });

  const completed = {
    ...topup,
    status: 'COMPLETED',
    paymentId,
    creditedTransactionId: credit.transactionId,
    completedAt: topup.completedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveTopup(completed, { onlyIfMatch: entry.etag });
  return Response.json({ ok: true, duplicate: credit.duplicate, balance: credit.balance });
};

export const config = { path: '/.netlify/functions/xendit-partner-webhook', method: 'POST' };
