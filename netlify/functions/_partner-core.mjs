import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const PARTNER_COOKIE = 'libra_partner_session';
const SESSION_SECONDS = 12 * 60 * 60;
const PARTNER_STORE = 'libra-partners';
const WALLET_STORE = 'libra-wallets';

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function readCookie(request, name) {
  const value = request.headers.get('cookie') || '';
  const match = value.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : '';
}

export function normalizePartnerId(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
}

export function normalizePhone(value) {
  let phone = String(value ?? '').trim().replace(/[\s().-]/g, '');
  if (phone.startsWith('0')) phone = `+62${phone.slice(1)}`;
  if (!phone.startsWith('+')) phone = `+${phone}`;
  return phone;
}

export function newPinHash(pin) {
  const clean = String(pin ?? '').trim();
  if (!/^\d{6}$/.test(clean)) throw new Error('PIN harus 6 digit.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(clean, salt, 64).toString('hex');
  return { pinSalt: salt, pinHash: hash };
}

export function verifyPin(pin, partner) {
  if (!partner?.pinSalt || !partner?.pinHash) return false;
  const actual = crypto.scryptSync(String(pin ?? ''), partner.pinSalt, 64).toString('hex');
  return safeEqual(actual, partner.pinHash);
}

export function makeApiCredentials() {
  return {
    apiKey: `lbr_${crypto.randomBytes(12).toString('hex')}`,
    apiSecret: crypto.randomBytes(32).toString('base64url'),
  };
}

export async function getPartner(partnerId) {
  const id = normalizePartnerId(partnerId);
  if (!id) return null;
  return getStore(PARTNER_STORE).get(`partner/${id}`, { type: 'json', consistency: 'strong' });
}

export async function savePartner(partner) {
  const id = normalizePartnerId(partner?.partnerId);
  if (!id) throw new Error('Partner ID tidak valid.');
  await getStore(PARTNER_STORE).setJSON(`partner/${id}`, { ...partner, partnerId: id });
}

export async function listPartners() {
  const store = getStore(PARTNER_STORE);
  const { blobs } = await store.list({ prefix: 'partner/' });
  const records = [];
  for (const blob of blobs) {
    const partner = await store.get(blob.key, { type: 'json' });
    if (partner) records.push(partner);
  }
  return records.sort((a, b) => String(a.companyName).localeCompare(String(b.companyName)));
}

export function issuePartnerSession(partnerId) {
  const secret = process.env.PARTNER_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('PARTNER_SESSION_SECRET belum dikonfigurasi.');
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = Buffer.from(JSON.stringify({ partnerId: normalizePartnerId(partnerId), expires, nonce: crypto.randomBytes(12).toString('hex') })).toString('base64url');
  const token = `${payload}.${hmac(payload, secret)}`;
  return `${PARTNER_COOKIE}=${token}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearPartnerSession() {
  return `${PARTNER_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export async function requirePartnerSession(request) {
  const token = readCookie(request, PARTNER_COOKIE);
  const secret = process.env.PARTNER_SESSION_SECRET;
  if (!token || !secret) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = hmac(payload, secret);
  if (!safeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data?.partnerId || data.expires <= Math.floor(Date.now() / 1000)) return null;
    const partner = await getPartner(data.partnerId);
    if (!partner || partner.status !== 'ACTIVE') return null;
    return partner;
  } catch {
    return null;
  }
}

export function validAdminSession(request) {
  const token = readCookie(request, 'libra_admin_session');
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!token || !secret) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  if (!safeEqual(signature, hmac(payload, secret))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).expires > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function walletStore() {
  return getStore(WALLET_STORE);
}

export async function getWallet(partnerId) {
  const id = normalizePartnerId(partnerId);
  const wallet = await walletStore().get(`balance/${id}`, { type: 'json', consistency: 'strong' });
  return wallet || { partnerId: id, balance: 0, processedRefs: {}, updatedAt: null };
}

export async function mutateWallet(partnerId, delta, reference, details = {}) {
  const id = normalizePartnerId(partnerId);
  const amount = Math.trunc(Number(delta));
  if (!id || !Number.isFinite(amount) || amount === 0) throw new Error('Mutasi saldo tidak valid.');
  const ref = String(reference ?? '').trim().slice(0, 160);
  if (!ref) throw new Error('Referensi mutasi wajib diisi.');
  const store = walletStore();
  const key = `balance/${id}`;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const currentEntry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    const current = currentEntry?.data || { partnerId: id, balance: 0, processedRefs: {}, updatedAt: null };
    const processedRefs = current.processedRefs || {};
    if (processedRefs[ref]) return { duplicate: true, balance: current.balance, transactionId: processedRefs[ref] };
    const before = Math.trunc(Number(current.balance || 0));
    const after = before + amount;
    if (after < 0) {
      const error = new Error('Saldo deposit tidak mencukupi.');
      error.code = 'INSUFFICIENT_BALANCE';
      error.balance = before;
      throw error;
    }
    const transactionId = `txn_${crypto.randomUUID()}`;
    const next = {
      partnerId: id,
      balance: after,
      processedRefs: { ...processedRefs, [ref]: transactionId },
      updatedAt: new Date().toISOString(),
    };
    const result = await store.setJSON(key, next, currentEntry ? { onlyIfMatch: currentEntry.etag } : { onlyIfNew: true });
    if (!result.modified) continue;

    const transaction = {
      transactionId,
      partnerId: id,
      direction: amount > 0 ? 'CREDIT' : 'DEBIT',
      amount: Math.abs(amount),
      signedAmount: amount,
      balanceBefore: before,
      balanceAfter: after,
      reference: ref,
      source: details.source || 'SYSTEM',
      description: details.description || '',
      metadata: details.metadata || null,
      createdAt: new Date().toISOString(),
    };
    await store.setJSON(`ledger/${id}/${transaction.createdAt}-${transactionId}`, transaction, { onlyIfNew: true });
    return { duplicate: false, balance: after, transactionId, transaction };
  }
  const error = new Error('Saldo sedang diproses. Coba kembali.');
  error.code = 'WALLET_BUSY';
  throw error;
}

export async function listWalletTransactions(partnerId, limit = 30) {
  const id = normalizePartnerId(partnerId);
  const store = walletStore();
  const { blobs } = await store.list({ prefix: `ledger/${id}/` });
  const selected = blobs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, Math.max(1, Math.min(limit, 100)));
  const rows = [];
  for (const blob of selected) {
    const row = await store.get(blob.key, { type: 'json' });
    if (row) rows.push(row);
  }
  return rows;
}

export async function saveTopup(topup, options = {}) {
  return walletStore().setJSON(`topup/${topup.referenceId}`, topup, options);
}

export async function getTopup(referenceId, withMetadata = false) {
  const key = `topup/${String(referenceId ?? '').trim()}`;
  return withMetadata
    ? walletStore().getWithMetadata(key, { type: 'json', consistency: 'strong' })
    : walletStore().get(key, { type: 'json', consistency: 'strong' });
}
