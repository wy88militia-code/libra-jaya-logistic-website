import { clearPartnerSession } from './_partner-core.mjs';

export default async () => new Response(null, {
  status: 302,
  headers: { location: '/partner/login.html', 'set-cookie': clearPartnerSession(), 'cache-control': 'no-store' },
});

export const config = { path: '/.netlify/functions/partner-logout' };
