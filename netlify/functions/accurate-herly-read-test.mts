import type { Config } from '@netlify/functions';
import { accurateGet } from './_accurate-core.mjs';

function clean(v: unknown, n = 180) {
  return String(v ?? '').trim().slice(0, n);
}

function maskPhone(v: unknown) {
  const s = clean(v, 80).replace(/\s+/g, '');
  if (!s) return null;
  if (s.length <= 6) return '*'.repeat(Math.max(0, s.length - 2)) + s.slice(-2);
  return s.slice(0, 3) + '*'.repeat(Math.max(3, s.length - 6)) + s.slice(-3);
}

function firstArray(data: any) {
  return Array.isArray(data?.d) ? data.d : [];
}

async function listAllCustomers() {
  const rows: any[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const { data } = await accurateGet('customer', 'list', {
      'sp.pageSize': 100,
      'sp.page': page,
      fields: 'id,no,name,mobilePhone,email,suspended',
    });
    rows.push(...firstArray(data));
    pageCount = Math.max(1, Math.min(Number(data?.sp?.pageCount) || 1, 100));
    page += 1;
  } while (page <= pageCount);
  return rows;
}

async function tryHistory(resource: string, customer: any) {
  const attempts = [
    { 'sp.pageSize': 20, 'sp.page': 1, 'sp.sort': 'transDate|desc', fields: 'id,number,transDate,customerId,customerNo,customerName,totalAmount', 'filter.customerId': customer.id },
    { 'sp.pageSize': 20, 'sp.page': 1, 'sp.sort': 'transDate|desc', fields: 'id,number,transDate,customerId,customerNo,customerName,totalAmount', 'filter.customerNo': customer.no },
  ];
  for (const params of attempts) {
    try {
      const { data } = await accurateGet(resource, 'list', params);
      const rows = firstArray(data);
      if (rows.length) return { ok: true, resource, rows };
    } catch {}
  }
  return { ok: false, resource, rows: [] as any[] };
}

function parseAccurateDate(value: unknown) {
  const s = clean(value, 40);
  if (!s) return 0;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function newestDate(...values: unknown[]) {
  const candidates = values.map(v => clean(v, 40)).filter(Boolean);
  candidates.sort((a, b) => parseAccurateDate(b) - parseAccurateDate(a));
  return candidates[0] || null;
}

export default async (req: Request) => {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  const expected = Netlify.env.get('HERLY_TEST_KEY') || '';
  if (!expected || key !== expected) return new Response('Not Found', { status: 404 });

  try {
    const customers = await listAllCustomers();
    const matches = customers.filter((c: any) => clean(c?.name, 200).toLowerCase().includes('herly'));
    const out: any[] = [];

    for (const c of matches.slice(0, 10)) {
      let detail: any = null;
      try {
        const { data } = await accurateGet('customer', 'detail', { id: c.id });
        detail = data?.d || null;
      } catch {}

      const invoice = await tryHistory('sales-invoice', c);
      const order = await tryHistory('sales-order', c);
      const invoiceRows = invoice.rows || [];
      const orderRows = order.rows || [];
      const lastInvoice = invoiceRows[0] || null;
      const lastOrder = orderRows[0] || null;
      const lastActivity = newestDate(lastInvoice?.transDate, lastOrder?.transDate);

      out.push({
        id: c.id,
        no: c.no || detail?.no || detail?.customerNo || null,
        name: c.name || detail?.name || null,
        suspended: Boolean(c.suspended ?? detail?.suspended ?? false),
        phoneMasked: maskPhone(detail?.mobilePhone || c.mobilePhone || detail?.phone),
        emailMasked: detail?.email ? String(detail.email).replace(/(^.).*(@.*$)/, '$1***$2') : null,
        lastSalesInvoice: lastInvoice ? { id: lastInvoice.id, number: lastInvoice.number || null, transDate: lastInvoice.transDate || null, totalAmount: lastInvoice.totalAmount ?? null } : null,
        lastSalesOrder: lastOrder ? { id: lastOrder.id, number: lastOrder.number || null, transDate: lastOrder.transDate || null, totalAmount: lastOrder.totalAmount ?? null } : null,
        lastActivity,
        lastActivityEpoch: parseAccurateDate(lastActivity),
      });
    }

    out.sort((a, b) => Number(b.lastActivityEpoch || 0) - Number(a.lastActivityEpoch || 0));
    const sanitized = out.map(({ lastActivityEpoch, ...row }) => row);
    return Response.json({
      ok: true,
      readOnly: true,
      database: Netlify.env.get('ACCURATE_PRODUCTION_DATABASE_NAME') || null,
      query: 'Herly',
      totalCustomersRead: customers.length,
      matches: sanitized,
      recommendedCustomer: sanitized.find(x => !x.suspended) || sanitized[0] || null,
      testedAt: new Date().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error: any) {
    return Response.json({ ok: false, readOnly: true, error: clean(error?.message || error, 800) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
};

export const config: Config = { path: '/internal/accurate-herly-read-test-7f4c2a91' };
