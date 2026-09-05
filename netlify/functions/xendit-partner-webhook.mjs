import crypto from 'node:crypto';
import { getTopup, mutateWallet, saveTopup } from './_partner-core.mjs';

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function num(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }

async function completeTopup(referenceId, paymentId, paidAmount, matcher = {}) {
  const entry = await getTopup(referenceId, true);
  if (!entry?.data) return { response: new Response('Topup not found', { status: 404 }) };
  const topup = entry.data;
  if (topup.status === 'COMPLETED') return { response: Response.json({ ok: true, duplicate: true }) };
  if (matcher.paymentSessionId && topup.paymentSessionId !== matcher.paymentSessionId) return { response: new Response('Payment mismatch', { status: 409 }) };
  if (matcher.paymentRequestId && topup.paymentRequestId !== matcher.paymentRequestId) return { response: new Response('Payment mismatch', { status: 409 }) };
  if (paidAmount !== Math.trunc(Number(topup.amount))) return { response: new Response('Payment mismatch', { status: 409 }) };

  const creditRef = `XENDIT:${paymentId}`;
  const credit = await mutateWallet(topup.partnerId, paidAmount, creditRef, {
    source: 'XENDIT',
    description: `Top-up deposit ${referenceId}`,
    metadata: { referenceId, paymentId, paymentSessionId: topup.paymentSessionId || '', paymentRequestId: topup.paymentRequestId || '', channel: topup.paymentMode || '' },
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
  return { response: Response.json({ ok: true, duplicate: credit.duplicate, balance: credit.balance }) };
}

export default async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const expectedToken = process.env.XENDIT_WEBHOOK_TOKEN;
  const suppliedToken = request.headers.get('x-callback-token') || '';
  if (!expectedToken || !safeEqual(suppliedToken, expectedToken)) return new Response('Unauthorized', { status: 401 });

  let event;
  try { event = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

  if (event?.event === 'payment.capture') {
    const data = event?.data || {};
    if (String(data.status || '').toUpperCase() !== 'SUCCEEDED') return new Response('Ignored', { status: 200 });
    if (String(data.metadata?.purpose || '') !== 'PARTNER_DEPOSIT') return new Response('Ignored', { status: 200 });
    const referenceId = String(data.reference_id || '').trim();
    const paymentId = String(data.payment_id || '').trim();
    const paymentRequestId = String(data.payment_request_id || '').trim();
    const paidAmount = Math.trunc(num(data.request_amount || (data.captures || []).reduce((sum, item) => sum + num(item.capture_amount), 0)));
    if (!referenceId || !paymentId || !paymentRequestId) return new Response('Ignored', { status: 200 });
    return (await completeTopup(referenceId, paymentId, paidAmount, { paymentRequestId })).response;
  }

  if (event?.event === 'payment_session.completed') {
    const data = event?.data || {};
    const referenceId = String(data.reference_id || '').trim();
    const paymentId = String(data.payment_id || data.payment_request_id || data.payment_session_id || '').trim();
    if (!referenceId || !paymentId || data.status !== 'COMPLETED') return new Response('Ignored', { status: 200 });
    const paidAmount = Math.trunc(Number(data.amount));
    return (await completeTopup(referenceId, paymentId, paidAmount, { paymentSessionId: data.payment_session_id })).response;
  }

  return new Response('Ignored', { status: 200 });
};

export const config = { path: '/.netlify/functions/xendit-partner-webhook', method: 'POST' };
