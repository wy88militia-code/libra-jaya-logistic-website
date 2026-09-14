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

function newestDate(...values: unknown[]) {
  return values.map(v => clean(v, 40)).filter(Boolean).sort().reverse()[0] || null;
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

      out.push({
        id: c.id,
        no: c.no || null,
        name: c.name || null,
        suspended: Boolean(c.suspended ?? detail?.suspended ?? false),
        phoneMasked: maskPhone(detail?.mobilePhone || c.mobilePhone || detail?.phone),
        emailMasked: detail?.email ? String(detail.email).replace(/(^.).*(@.*$)/, '$1***$2') : null,
        lastSalesInvoice: lastInvoice ? { id: lastInvoice.id, number: lastInvoice.number || null, transDate: lastInvoice.transDate || null, totalAmount: lastInvoice.totalAmount ?? null } : null,
        lastSalesOrder: lastOrder ? { id: lastOrder.id, number: lastOrder.number || null, transDate: lastOrder.transDate || null, totalAmount: lastOrder.totalAmount ?? null } : null,
        lastActivity: newestDate(lastInvoice?.transDate, lastOrder?.transDate),
      });
    }

    out.sort((a, b) => String(b.lastActivity || '').localeCompare(String(a.lastActivity || '')));
    return Response.json({
      ok: true,
      readOnly: true,
      database: Netlify.env.get('ACCURATE_PRODUCTION_DATABASE_NAME') || null,
      query: 'Herly',
      totalCustomersRead: customers.length,
      matches: out,
      recommendedCustomer: out.find(x => !x.suspended) || out[0] || null,
      testedAt: new Date().toISOString(),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error: any) {
    return Response.json({ ok: false, readOnly: true, error: clean(error?.message || error, 800) }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
};

export const config: Config = { path: '/internal/accurate-herly-read-test-7f4c2a91' };
