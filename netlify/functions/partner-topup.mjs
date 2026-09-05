import crypto from 'node:crypto';
import { getUatRecord } from './_api-uat-core.mjs';
import { requirePartnerSession, saveTopup } from './_partner-core.mjs';

function basicAuth(secret) {
  return `Basic ${Buffer.from(`${secret}:`).toString('base64')}`;
}
function cleanName(value) {
  const text = String(value || 'Partner').normalize('NFKD').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 50) || 'Partner';
}
function qrisAction(result) {
  return (result?.actions || []).find((item) => item?.descriptor === 'QR_STRING' || item?.type === 'PRESENT_TO_CUSTOMER');
}

export default async (request) => {
  const partner = await requirePartnerSession(request);
  if (!partner) return Response.json({ message: 'Sesi partner tidak valid.' }, { status: 401 });
  if (request.method !== 'POST') return Response.json({ message: 'Metode tidak diizinkan.' }, { status: 405 });

  if (partner.onboardingApplicationId) {
    const uat = await getUatRecord(partner.partnerId);
    if (!uat || String(uat.finalDecision || '').toUpperCase() !== 'PASS') {
      return Response.json({ message: 'Deposit partner API baru dibuka setelah UAT mendapat Final PASS dari Admin Libra.', code: 'API_DEPOSIT_LOCKED_UNTIL_UAT_PASS' }, { status: 409 });
    }
  }

  const xenditKey = process.env.XENDIT_SECRET_KEY;
  if (!xenditKey) return Response.json({ message: 'Xendit belum dikonfigurasi oleh admin.' }, { status: 503 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ message: 'Permintaan tidak valid.' }, { status: 400 }); }
  const amount = Math.trunc(Number(body?.amount));
  const minTopup = Math.max(10000, Math.trunc(Number(process.env.PARTNER_MIN_TOPUP || 100000)));
  const maxTopup = Math.max(minTopup, Math.trunc(Number(process.env.PARTNER_MAX_TOPUP || 500000000)));
  const qrisMax = Math.max(minTopup, Math.trunc(Number(process.env.PARTNER_QRIS_MAX_AMOUNT || 10000000)));
  if (!Number.isFinite(amount) || amount < minTopup || amount > maxTopup) {
    return Response.json({ message: `Nominal top-up harus Rp${minTopup.toLocaleString('id-ID')}–Rp${maxTopup.toLocaleString('id-ID')}.` }, { status: 400 });
  }

  const referenceId = `LBRTP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`.slice(0, 64);
  const origin = new URL(request.url).origin;
  const requestedMethod = String(body?.method || 'AUTO').toUpperCase();
  const useQris = requestedMethod === 'QRIS' || (requestedMethod === 'AUTO' && amount <= qrisMax);
  if (requestedMethod === 'QRIS' && amount > qrisMax) {
    return Response.json({ message: `QRIS otomatis dibatasi sampai Rp${qrisMax.toLocaleString('id-ID')} per transaksi. Gunakan Pembayaran Xendit untuk nominal lebih besar.`, code: 'QRIS_AMOUNT_LIMIT', qrisMax }, { status: 422 });
  }

  if (useQris) {
    const payload = {
      reference_id: referenceId,
      type: 'PAY',
      country: 'ID',
      currency: 'IDR',
      request_amount: amount,
      capture_method: 'AUTOMATIC',
      channel_code: 'QRIS',
      description: `Top-up deposit Partner Libra ${partner.partnerId}`,
      metadata: { partner_id: partner.partnerId, purpose: 'PARTNER_DEPOSIT' },
    };
    let response;
    try {
      response = await fetch('https://api.xendit.co/v3/payment_requests', {
        method: 'POST',
        headers: { authorization: basicAuth(xenditKey), 'content-type': 'application/json', 'api-version': '2024-11-11' },
        body: JSON.stringify(payload),
      });
    } catch {
      return Response.json({ message: 'Tidak dapat menghubungi Xendit.' }, { status: 502 });
    }
    const result = await response.json().catch(() => ({}));
    const action = qrisAction(result);
    if (!response.ok || !result?.payment_request_id || !action?.value) {
      return Response.json({ message: result?.message || 'Xendit menolak pembuatan QRIS.', code: result?.error_code || null }, { status: 502 });
    }
    const expiresAt = result?.channel_properties?.expires_at || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const topup = {
      referenceId,
      partnerId: partner.partnerId,
      amount,
      status: 'PENDING',
      paymentMode: 'QRIS',
      paymentRequestId: result.payment_request_id,
      qrString: String(action.value),
      expiresAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveTopup(topup, { onlyIfNew: true });
    return Response.json({ ok: true, referenceId, amount, status: topup.status, paymentMode: 'QRIS', paymentRequestId: topup.paymentRequestId, qrString: topup.qrString, expiresAt, qrisMax });
  }

  const fullName = cleanName(partner.picName || partner.companyName);
  const [given, ...rest] = fullName.split(' ');
  const customerReference = `${partner.partnerId}${Date.now()}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
  const payload = {
    reference_id: referenceId,
    session_type: 'PAY',
    mode: 'PAYMENT_LINK',
    amount,
    currency: 'IDR',
    country: 'ID',
    capture_method: 'AUTOMATIC',
    locale: 'id',
    description: `Top-up deposit ${partner.partnerId}`,
    customer: {
      reference_id: customerReference,
      type: 'INDIVIDUAL',
      email: partner.email,
      mobile_number: partner.phone,
      individual_detail: { given_names: given || 'Partner', surname: rest.join(' ') || 'Libra' },
    },
    metadata: { partner_id: partner.partnerId, purpose: 'PARTNER_DEPOSIT' },
    success_return_url: `${origin}/partner/wallet.html?payment=success&ref=${encodeURIComponent(referenceId)}`,
    cancel_return_url: `${origin}/partner/wallet.html?payment=cancel&ref=${encodeURIComponent(referenceId)}`,
  };

  let response;
  try {
    response = await fetch('https://api.xendit.co/sessions', {
      method: 'POST',
      headers: { authorization: basicAuth(xenditKey), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return Response.json({ message: 'Tidak dapat menghubungi Xendit.' }, { status: 502 });
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.payment_link_url || !result?.payment_session_id) {
    return Response.json({ message: result?.message || 'Xendit menolak pembuatan top-up.', code: result?.error_code || null }, { status: 502 });
  }

  const topup = {
    referenceId,
    partnerId: partner.partnerId,
    amount,
    status: 'PENDING',
    paymentMode: 'PAYMENT_LINK',
    paymentSessionId: result.payment_session_id,
    paymentLinkUrl: result.payment_link_url,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveTopup(topup, { onlyIfNew: true });
  return Response.json({ ok: true, referenceId, amount, status: topup.status, paymentMode: 'PAYMENT_LINK', paymentLinkUrl: topup.paymentLinkUrl, qrisMax });
};

export const config = {
  path: '/.netlify/functions/partner-topup',
  method: 'POST',
  rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: 'ip', action: 'rate_limit' },
};
