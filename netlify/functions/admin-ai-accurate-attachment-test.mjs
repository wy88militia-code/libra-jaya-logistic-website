import { accurateGet } from './_accurate-core.mjs';
import { assertAdminPermission } from './_admin-rbac-core.mjs';
import { getAdminSession } from './_partner-core.mjs';

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const attachmentKey=/attach|attachment|document|dokumen|file|media|image|photo|foto|upload|url|uri|path/i;
const safeKey=/^(id|number|transDate|date|totalAmount|amount|customerName|description|memo|bank|bankName|reference|refNo|paymentMethod|chequeNo|branchName)$/i;

function inspect(value,path='',out=[],depth=0){
  if(depth>7||out.length>100)return out;
  if(Array.isArray(value)){value.slice(0,30).forEach((v,i)=>inspect(v,`${path}[${i}]`,out,depth+1));return out;}
  if(value&&typeof value==='object'){
    for(const [k,v] of Object.entries(value)){
      const p=path?`${path}.${k}`:k;
      if(attachmentKey.test(k))out.push({path:p,type:Array.isArray(v)?'array':typeof v,preview:typeof v==='string'?clean(v,220):Array.isArray(v)?`Array(${v.length})`:v&&typeof v==='object'?`Object(${Object.keys(v).slice(0,12).join(', ')})`:clean(v,220)});
      inspect(v,p,out,depth+1);
    }
  }
  return out;
}
function summary(row){const out={};for(const [k,v] of Object.entries(row||{}))if(safeKey.test(k)&&['string','number','boolean'].includes(typeof v))out[k]=v;return out;}
async function recentLionReceipts(){
  const attempts=['id,number,transDate,totalAmount,customerName','id,number,transDate,totalAmount'];
  for(const fields of attempts){try{const {data}=await accurateGet('sales-receipt','list',{'sp.pageSize':100,'sp.page':1,'sp.sort':'transDate|desc',fields});const rows=Array.isArray(data?.d)?data.d:[];const lion=rows.filter(r=>/lion\s*parcel/i.test(String(r?.customerName||'')));return lion.length?lion:rows.slice(0,20);}catch{}}
  return [];
}
async function probeDetail(id){
  const {data}=await accurateGet('sales-receipt','detail',{id});
  const row=data?.d??data;
  return {summary:summary(row),attachmentSignals:inspect(row),topLevelKeys:row&&typeof row==='object'?Object.keys(row).sort():[]};
}
export default async request=>{
  const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);
  try{assertAdminPermission(session,'finance.reconcile');}catch{return new Response('Forbidden',{status:403});}
  if(request.method!=='GET')return new Response('Method not allowed',{status:405});
  const url=new URL(request.url),id=clean(url.searchParams.get('id'),100);let receipts=[],result=null,error='';
  try{receipts=await recentLionReceipts();if(id)result=await probeDetail(id);}catch(e){error=clean(e?.message||e,700);}
  const options=receipts.map(r=>`<option value="${esc(r.id)}" ${String(r.id)===id?'selected':''}>${esc(r.number||r.id)} • ${esc(r.transDate||'')} • ${esc(r.customerName||'')}</option>`).join('');
  const signals=(result?.attachmentSignals||[]).map(x=>`<tr><td>${esc(x.path)}</td><td>${esc(x.type)}</td><td>${esc(x.preview)}</td></tr>`).join('');
  return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Tes Attachment Accurate</title><style>body{font-family:system-ui;background:#f3f6f9;color:#10243d;margin:0}.w{max-width:980px;margin:auto;padding:24px}.c{background:white;border:1px solid #dce6ef;border-radius:16px;padding:18px;margin:12px 0}select,button{padding:11px;border-radius:9px}button{background:#075182;color:white;border:0;font-weight:800}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}.ok{color:#176b37}.bad{color:#9e2621}code{white-space:pre-wrap;word-break:break-word}</style></head><body><main class="w"><h1>Tes Baca Attachment Accurate</h1><p>READ-ONLY • Penerimaan Penjualan • tidak download, tidak posting, tidak mengubah Accurate.</p><section class="c"><form method="get"><label>Pilih Penerimaan Penjualan</label><br><select name="id" required><option value="">— pilih —</option>${options}</select> <button type="submit">Baca Detail</button></form>${error?`<p class="bad"><b>ERROR:</b> ${esc(error)}</p>`:''}</section>${result?`<section class="c"><h2>${result.attachmentSignals.length?'<span class="ok">Referensi attachment/file terdeteksi</span>':'<span class="bad">Belum ada field attachment/file pada response detail</span>'}</h2><p><b>Field detail yang dikembalikan:</b> ${esc(result.topLevelKeys.join(', '))}</p><table><thead><tr><th>Path</th><th>Tipe</th><th>Preview metadata</th></tr></thead><tbody>${signals||'<tr><td colspan="3">Tidak ditemukan key attachment/document/file/media/image/photo/url.</td></tr>'}</tbody></table><h3>Ringkasan transaksi</h3><code>${esc(JSON.stringify(result.summary,null,2))}</code></section>`:''}<p><a href="/admin-ai-accurate">← AI Agent Accurate</a></p></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-ai-accurate/attachment-test'};
