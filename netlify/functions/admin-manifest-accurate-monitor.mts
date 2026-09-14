import type { Config } from '@netlify/functions';
import { listAccurateJobs, testAccurateConnection } from './_accurate-core.mjs';
import { listManifests } from './_manifest-core.mjs';
import { getAdminSession } from './_partner-core.mjs';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
const fmt = (v: unknown) => Number(v || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const when = (v: unknown) => {
  const s = String(v || '').trim();
  if (!s) return '-';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : new Intl.DateTimeFormat('id-ID', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Jayapura' }).format(d) + ' WIT';
};

function jobManifestId(job: any) {
  return String(
    job?.manifestId ||
    job?.sourceId ||
    job?.metadata?.manifestId ||
    job?.payload?.manifestId ||
    job?.journalDraft?.manifestId ||
    job?.salesOrderDraft?.manifestId ||
    ''
  ).trim();
}

function jobMentionsManifest(job: any, manifestId: string) {
  if (!manifestId) return false;
  if (jobManifestId(job) === manifestId) return true;
  const hay = [
    job?.jobId, job?.statementNo, job?.journalNumber, job?.accurateReference,
    job?.description, job?.lastError, job?.metadata?.description,
    job?.payload?.description, job?.journalDraft?.description,
    job?.salesOrderDraft?.description, job?.salesOrderDraft?.poNumber,
  ].filter(Boolean).join(' ').toUpperCase();
  return hay.includes(manifestId.toUpperCase());
}

function classify(job: any) {
  if (!job) return { key:'NOT_SENT', label:'BELUM DIKIRIM', kind:'idle' };
  const s = String(job.status || '').toUpperCase();
  if (['POSTED','VERIFIED','SUCCESS','SYNCED','COMPLETED'].includes(s)) return { key:'SUCCESS', label:'SUKSES', kind:'ok' };
  if (['POST_FAILED','FAILED','ERROR','RECONCILE_REQUIRED','NEEDS_MAPPING','BLOCKED'].includes(s)) return { key:'FAILED', label:'GAGAL / REVIEW', kind:'bad' };
  return { key:'PENDING', label:'MENUNGGU', kind:'wait' };
}

export default async (req: Request) => {
  const session = getAdminSession(req);
  if (!session) return Response.redirect(new URL('/libra-admin-login.html', req.url), 302);

  const url = new URL(req.url);
  const filter = String(url.searchParams.get('status') || 'ALL').toUpperCase();
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();

  let connection: any = null;
  let connectionError = '';
  try { connection = await testAccurateConnection(); }
  catch (e: any) { connectionError = String(e?.message || e || 'Koneksi Accurate gagal'); }

  const [manifests, jobs] = await Promise.all([listManifests(300), listAccurateJobs(1000)]);
  const rows = manifests.map((m: any) => {
    const related = jobs.filter((j: any) => jobMentionsManifest(j, m.manifestId));
    related.sort((a: any, b: any) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    const job = related[0] || null;
    const state = classify(job);
    return { manifest:m, job, state };
  });

  const counts = rows.reduce((a: any, r: any) => { a[r.state.key] = (a[r.state.key] || 0) + 1; return a; }, {SUCCESS:0,FAILED:0,PENDING:0,NOT_SENT:0});
  const visible = rows.filter((r: any) => {
    if (filter !== 'ALL' && r.state.key !== filter) return false;
    if (!q) return true;
    const m = r.manifest;
    const j = r.job || {};
    return [m.manifestId,m.origin,m.destination,m.carrier,m.serviceNumber,j.jobId,j.accurateReference,j.status].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const tabs = [
    ['ALL','Semua',rows.length],['SUCCESS','Sukses',counts.SUCCESS],['FAILED','Gagal',counts.FAILED],['PENDING','Menunggu',counts.PENDING],['NOT_SENT','Belum Dikirim',counts.NOT_SENT]
  ].map(([k,l,n]) => `<a class="tab ${filter===k?'active':''}" href="?status=${k}${q?`&q=${encodeURIComponent(q)}`:''}">${l} <b>${n}</b></a>`).join('');

  const body = visible.map((r: any) => {
    const m = r.manifest, j = r.job;
    const ref = j?.accurateReference || j?.salesOrderNumber || j?.orderNumber || j?.journalNumber || j?.accurateId || '-';
    return `<tr>
      <td><strong>${esc(m.manifestId)}</strong><small>${esc(m.mode)} • ${esc(m.status)}</small></td>
      <td>${esc(m.origin)} → ${esc(m.destination)}<small>${esc(m.carrier || '-')} ${esc(m.serviceNumber || '')}</small></td>
      <td class="num">${fmt(m.summary?.bookingCount)}<small>${fmt(m.summary?.actualWeightKg)} kg</small></td>
      <td><span class="badge ${r.state.kind}">${esc(r.state.label)}</span><small>${esc(j?.status || 'Tidak ada job Accurate')}</small></td>
      <td><strong>${esc(ref)}</strong><small>${esc(j?.jobId || '-')}</small></td>
      <td>${esc(when(j?.postedAt || j?.updatedAt || j?.createdAt || m.updatedAt))}</td>
      <td class="error">${esc(j?.lastError || '-')}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="empty">Tidak ada data untuk filter ini.</td></tr>`;

  const connectionClass = connection?.ok ? 'conn-ok' : 'conn-bad';
  const connectionText = connection?.ok ? `TERHUBUNG • ${connection?.database?.alias || connection?.database?.name || 'Accurate Online'}` : `GAGAL • ${connectionError || 'Tidak terhubung'}`;

  return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="30"><title>Monitor Manifest → Accurate</title><style>
  *{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:#f3f6f9;color:#10243d}.top{background:#061d36;color:#fff;padding:20px}.topin,.wrap{max-width:1280px;margin:auto}.topin{display:flex;justify-content:space-between;gap:14px;align-items:center}.top a{color:#fff;text-decoration:none;border:1px solid #58718b;border-radius:9px;padding:8px 12px}.wrap{padding:24px 16px 48px}.hero{display:flex;justify-content:space-between;gap:18px;align-items:flex-end;background:#fff;border:1px solid #dbe5ee;border-radius:18px;padding:22px;margin-bottom:14px}.hero h1{margin:0 0 6px;font-size:28px}.hero p{margin:0;color:#63768a}.conn{padding:10px 13px;border-radius:11px;font-weight:900;font-size:12px;max-width:420px}.conn-ok{background:#e7f6ed;color:#16723b}.conn-bad{background:#ffebe9;color:#a52d25}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}.stat{background:#fff;border:1px solid #dbe5ee;border-radius:15px;padding:16px}.stat b{display:block;font-size:27px}.stat span{color:#64778a;font-size:12px;font-weight:800}.oktxt{color:#16723b}.badtxt{color:#b23028}.waittxt{color:#a56c00}.idletxt{color:#68798a}.tools{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin:16px 0}.tabs{display:flex;gap:8px;flex-wrap:wrap}.tab{text-decoration:none;background:#e9eff5;color:#28445f;border-radius:999px;padding:8px 11px;font-size:12px;font-weight:800}.tab.active{background:#0b2d52;color:#fff}.tab b{margin-left:4px}.search{display:flex;gap:7px}.search input{border:1px solid #cbd8e4;border-radius:9px;padding:9px 10px;min-width:220px}.search button{border:0;background:#0b2d52;color:#fff;border-radius:9px;padding:9px 13px;font-weight:800}.tablewrap{background:#fff;border:1px solid #dbe5ee;border-radius:16px;overflow:auto}table{border-collapse:collapse;width:100%;min-width:1100px}th,td{padding:13px 12px;border-bottom:1px solid #e8eef4;text-align:left;vertical-align:top;font-size:13px}th{background:#f7f9fb;font-size:11px;letter-spacing:.02em;color:#617486}td small{display:block;color:#718398;margin-top:4px}.num{text-align:right}.badge{display:inline-block;padding:6px 9px;border-radius:999px;font-size:10px;font-weight:900}.badge.ok{background:#e7f6ed;color:#16723b}.badge.bad{background:#ffebe9;color:#a52d25}.badge.wait{background:#fff4cf;color:#835d08}.badge.idle{background:#edf1f5;color:#657688}.error{max-width:260px;color:#9b332d}.empty{text-align:center;padding:34px;color:#718398}.note{margin-top:14px;background:#eef5fb;border:1px solid #d4e4f1;border-radius:13px;padding:13px;color:#456078;font-size:12px;line-height:1.5}@media(max-width:760px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{align-items:flex-start;flex-direction:column}.search{width:100%}.search input{min-width:0;flex:1}}
  </style></head><body><header class="top"><div class="topin"><div><strong>LIBRA JAYA LOGISTIC</strong><div style="font-size:12px;color:#bfd0df;margin-top:3px">Libra Tools • Monitor Manifest → Accurate</div></div><a href="/admin-tool">← Libra Tools</a></div></header><main class="wrap"><section class="hero"><div><h1>Monitor Manifest → Accurate</h1><p>Memantau apakah setiap manifest berhasil masuk ke Accurate Online, masih menunggu, gagal, atau belum pernah dikirim.</p></div><div class="conn ${connectionClass}">${esc(connectionText)}</div></section><section class="stats"><div class="stat"><b class="oktxt">${counts.SUCCESS}</b><span>SUKSES</span></div><div class="stat"><b class="badtxt">${counts.FAILED}</b><span>GAGAL / REVIEW</span></div><div class="stat"><b class="waittxt">${counts.PENDING}</b><span>MENUNGGU</span></div><div class="stat"><b class="idletxt">${counts.NOT_SENT}</b><span>BELUM DIKIRIM</span></div></section><div class="tools"><div class="tabs">${tabs}</div><form class="search" method="get"><input type="hidden" name="status" value="${esc(filter)}"><input name="q" value="${esc(q)}" placeholder="Cari manifest / rute / ref Accurate"><button>Cari</button></form></div><div class="tablewrap"><table><thead><tr><th>Manifest</th><th>Rute</th><th>Booking / Berat</th><th>Status Accurate</th><th>Referensi Accurate</th><th>Update Terakhir</th><th>Error</th></tr></thead><tbody>${body}</tbody></table></div><div class="note"><strong>Definisi status:</strong> SUKSES = job Accurate sudah POSTED/VERIFIED/SYNCED; MENUNGGU = queue/proses belum final; GAGAL/REVIEW = posting gagal, mapping bermasalah, atau perlu rekonsiliasi; BELUM DIKIRIM = manifest belum memiliki catatan job Accurate. Halaman refresh otomatis setiap 30 detik.</div></main></body></html>`, { headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"} });
};

export const config: Config = { path:'/admin-manifest-accurate-monitor' };
