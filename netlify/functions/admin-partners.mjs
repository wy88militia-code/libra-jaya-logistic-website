import { getWallet, listPartners, makeApiCredentials, newPinHash, normalizePartnerId, normalizePhone, savePartner, validAdminSession } from './_partner-core.mjs';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function render(rows, message = '', credentials = null) {
  const partnerRows = rows.map((row) => `<tr><td>${escapeHtml(row.partnerId)}</td><td>${escapeHtml(row.companyName)}</td><td>${escapeHtml(row.picName)}</td><td>${escapeHtml(row.status)}</td><td>Rp${Number(row.balance || 0).toLocaleString('id-ID')}</td></tr>`).join('');
  const credentialBox = credentials ? `<div class="credential"><strong>Simpan sekali sekarang.</strong><br>Partner ID: <code>${escapeHtml(credentials.partnerId)}</code><br>API Key: <code>${escapeHtml(credentials.apiKey)}</code><br>API Secret: <code>${escapeHtml(credentials.apiSecret)}</code></div>` : '';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Admin Partner Libra</title><style>body{margin:0;font-family:system-ui;background:#eef4f9;color:#10243d}.wrap{max-width:1050px;margin:auto;padding:24px}.card{background:#fff;padding:22px;border-radius:18px;margin-bottom:18px;box-shadow:0 8px 30px #0b2d5212}h1{margin-top:0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}input,select,button{font:inherit;padding:12px;border-radius:10px;border:1px solid #cbd8e6}button{background:#ef312b;color:#fff;border:0;font-weight:800;cursor:pointer}.full{grid-column:1/-1}.msg{padding:10px;border-radius:8px;background:#eef7ff}.credential{padding:14px;background:#fff8dc;border:1px solid #eed98d;border-radius:10px;margin-top:12px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #e7edf4;text-align:left}code{word-break:break-all}@media(max-width:700px){.grid{grid-template-columns:1fr}.full{grid-column:auto}table{font-size:12px}}</style></head><body><main class="wrap"><div class="card"><h1>Partner & Deposit</h1><p>Buat akun partner. PIN dipakai portal manual; API Key/Secret dipakai integrasi sistem.</p>${message ? `<p class="msg">${escapeHtml(message)}</p>` : ''}${credentialBox}<form method="post" class="grid"><input name="partnerId" placeholder="Partner ID, contoh AFA001" required><input name="companyName" placeholder="Nama perusahaan" required><input name="picName" placeholder="Nama PIC" required><input type="email" name="email" placeholder="Email PIC" required><input name="phone" placeholder="No HP +628..." required><input name="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="PIN 6 digit" required><select name="status"><option value="ACTIVE">ACTIVE</option><option value="PENDING">PENDING</option></select><button type="submit">Daftarkan Partner</button></form></div><div class="card"><h2>Daftar Partner</h2><table><thead><tr><th>ID</th><th>Perusahaan</th><th>PIC</th><th>Status</th><th>Saldo</th></tr></thead><tbody>${partnerRows || '<tr><td colspan="5">Belum ada partner.</td></tr>'}</tbody></table></div><a href="/admin-tool">← Kembali ke Admin Tool</a></main></body></html>`;
}

async function loadRows() {
  const partners = await listPartners();
  return Promise.all(partners.map(async (partner) => ({ ...partner, balance: (await getWallet(partner.partnerId)).balance })));
}

export default async (request) => {
  if (!validAdminSession(request)) return Response.redirect(new URL('/admin-login.html', request.url), 302);
  if (request.method === 'GET') return new Response(render(await loadRows()), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const form = await request.formData();
  const partnerId = normalizePartnerId(form.get('partnerId'));
  if (!partnerId) return new Response(render(await loadRows(), 'Partner ID tidak valid.'), { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } });
  const credentials = makeApiCredentials();
  const pin = newPinHash(form.get('pin'));
  const partner = {
    partnerId,
    companyName: String(form.get('companyName') || '').trim().slice(0, 120),
    picName: String(form.get('picName') || '').trim().slice(0, 100),
    email: String(form.get('email') || '').trim().toLowerCase().slice(0, 120),
    phone: normalizePhone(form.get('phone')),
    status: String(form.get('status') || 'PENDING') === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
    ...pin,
    ...credentials,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await savePartner(partner);
  return new Response(render(await loadRows(), 'Partner berhasil dibuat.', { partnerId, ...credentials }), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
};

export const config = { path: '/admin-partners' };
