import crypto from 'node:crypto';
import { backupPolicy, createBackup, getBackup, listBackups, pruneBackups } from './_backup-core.mjs';
import { listAdminAudit, verifyAuditChain, writeAdminAudit } from './_admin-audit-core.mjs';
import { createApprovalRequest } from './_maker-checker-core.mjs';
import { importOffsiteBackup, offsiteBackupConfig } from './_offsite-backup-core.mjs';
import { getAdminSession } from './_partner-core.mjs';

const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const fmtBytes=v=>{const n=Number(v)||0;if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;return `${(n/1048576).toFixed(1)} MB`;};
function sameOrigin(request){const origin=request.headers.get('origin');if(!origin)return true;try{return new URL(origin).origin===new URL(request.url).origin;}catch{return false;}}
function stamp(v){try{return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Jayapura'}).format(new Date(v))+' WIT';}catch{return v||'—';}}
function sha256(bytes){return crypto.createHash('sha256').update(bytes).digest('hex');}

function verifyBackupPayload(backup,policy){
  if(!backup?.backupId)throw new Error('Payload backup tidak valid.');
  const {checksum,...raw}=backup;
  const manifestActual=sha256(Buffer.from(JSON.stringify(raw)));
  if(!checksum||checksum!==manifestActual)throw new Error('Checksum manifest backup tidak valid. Recovery diblokir.');
  let checkedEntries=0,checkedBytes=0,restorableEntries=0,immutableEntries=0;
  const stores=[];
  for(const snapshot of backup.stores||[]){
    let count=0,bytes=0,bad=0;
    for(const entry of snapshot.entries||[]){
      const body=Buffer.from(String(entry.base64||''),'base64');
      const digest=sha256(body);
      count+=1;bytes+=body.length;checkedEntries+=1;checkedBytes+=body.length;
      if(digest!==entry.sha256||body.length!==Number(entry.size||0))bad+=1;
    }
    if(bad)throw new Error(`Integritas entry gagal pada store ${snapshot.name}: ${bad} item.`);
    const immutable=policy.immutableOnRestore.includes(snapshot.name);
    if(immutable)immutableEntries+=count;else restorableEntries+=count;
    stores.push({name:snapshot.name,count,bytes,immutable,status:'VERIFIED'});
  }
  if(Number(backup.totalEntries)!==checkedEntries)throw new Error(`Jumlah item tidak cocok. Manifest ${backup.totalEntries}, hasil verifikasi ${checkedEntries}.`);
  if(Number(backup.totalBytes)!==checkedBytes)throw new Error(`Ukuran backup tidak cocok. Manifest ${backup.totalBytes}, hasil verifikasi ${checkedBytes}.`);
  return {status:'READY',manifestChecksum:'VALID',checkedEntries,checkedBytes,restorableEntries,immutableEntries,stores};
}

export default async request=>{
  const session=getAdminSession(request);if(!session)return Response.redirect(new URL('/libra-admin-login.html',request.url),302);
  const isSuperAdmin=String(session.role||'').toUpperCase()==='SUPERADMIN';
  let message='',error='',recoveryPlan=null;
  if(request.method==='POST'){
    if(!sameOrigin(request))return new Response('Forbidden',{status:403});
    const form=await request.formData();const action=String(form.get('action')||'');
    try{
      if(action==='create_backup'){
        const backup=await createBackup({kind:'MANUAL',actor:session.username,reason:String(form.get('reason')||'Manual Admin backup')});
        await writeAdminAudit({session,request,action:'BACKUP_CREATE',entityType:'BACKUP',entityId:backup.backupId,after:{kind:backup.kind,totalEntries:backup.totalEntries,totalBytes:backup.totalBytes,checksum:backup.checksum},note:backup.reason});
        message=`Backup ${backup.backupId} selesai: ${backup.totalEntries} item.`;
      }else if(action==='prune'){
        const result=await pruneBackups();
        await writeAdminAudit({session,request,action:'BACKUP_RETENTION_PRUNE',entityType:'BACKUP',entityId:'RETENTION',after:result});
        message=`Retention selesai. ${result.deleted} backup lama dihapus.`;
      }else if(action==='assist_recovery'){
        if(!isSuperAdmin)throw new Error('AI Assisted Recovery hanya tersedia untuk SUPERADMIN.');
        const backupId=String(form.get('backupId')||'').trim();if(!backupId)throw new Error('Backup ID wajib diisi.');
        const requestedSource=String(form.get('source')||'AUTO').toUpperCase();
        if(!['AUTO','INTERNAL','OFFSITE'].includes(requestedSource))throw new Error('Sumber recovery tidak valid.');
        const policy=backupPolicy(),offsite=offsiteBackupConfig();
        let backup=null,source='INTERNAL',imported=false;
        if(requestedSource!=='OFFSITE')backup=await getBackup(backupId);
        if(!backup&&requestedSource==='INTERNAL')throw new Error('Backup internal tidak ditemukan. Pilih AUTO/OFFSITE bila salinan off-site tersedia.');
        if(!backup){
          if(!offsite.configured)throw new Error(`Backup internal tidak ditemukan dan off-site belum siap: ${offsite.missing.join(', ')}`);
          const importedResult=await importOffsiteBackup(backupId);backup=importedResult.backup;source='OFFSITE';imported=true;
        }
        if(requestedSource==='OFFSITE'&&source!=='OFFSITE'){
          if(!offsite.configured)throw new Error(`Off-site belum siap: ${offsite.missing.join(', ')}`);
          const importedResult=await importOffsiteBackup(backupId);backup=importedResult.backup;source='OFFSITE';imported=true;
        }
        const verified=verifyBackupPayload(backup,policy);
        recoveryPlan={backupId:backup.backupId,kind:backup.kind,createdAt:backup.createdAt,actor:backup.actor,reason:backup.reason,source,imported,offsiteConfigured:offsite.configured,totalEntries:backup.totalEntries,totalBytes:backup.totalBytes,checksum:backup.checksum,...verified};
        await writeAdminAudit({session,request,action:'AI_RECOVERY_VERIFY',entityType:'BACKUP',entityId:backupId,after:{source,imported,status:recoveryPlan.status,manifestChecksum:recoveryPlan.manifestChecksum,checkedEntries:recoveryPlan.checkedEntries,restorableEntries:recoveryPlan.restorableEntries,immutableEntries:recoveryPlan.immutableEntries},note:'AI Assisted Recovery preview: verifikasi kriptografis tanpa restore.'});
        message=`Recovery plan ${backupId} siap. Tidak ada data yang direstore pada tahap verifikasi ini.`;
      }else if(action==='restore'){
        const backupId=String(form.get('backupId')||'').trim();const confirmation=String(form.get('confirmation')||'').trim();
        if(confirmation!==`RESTORE ${backupId}`)throw new Error(`Konfirmasi harus persis: RESTORE ${backupId}`);
        const reason=String(form.get('reason')||'').trim();if(!reason)throw new Error('Alasan Disaster Recovery wajib diisi.');
        const approval=await createApprovalRequest({session,actionType:'DR_RESTORE',entityId:backupId,payload:{backupId},reason,expiresHours:24});
        await writeAdminAudit({session,request,action:'MAKER_CHECKER_REQUEST',entityType:'APPROVAL_REQUEST',entityId:approval.requestId,after:{actionType:approval.actionType,backupId,status:approval.status},note:`Restore ${backupId} diajukan: ${reason}`});
        message=`Request ${approval.requestId} dibuat. Restore BELUM dijalankan; SUPERADMIN lain harus menyetujui.`;
      }else throw new Error('Aksi tidak dikenal.');
    }catch(e){error=e?.message||'Proses backup/audit gagal.';}
  }else if(request.method!=='GET')return new Response('Method not allowed',{status:405});

  const [backups,audits,chain]=await Promise.all([listBackups(80),listAdminAudit(300),verifyAuditChain(1000)]);const policy=backupPolicy(),offsite=offsiteBackupConfig();
  const backupOptions=backups.map(b=>`<option value="${esc(b.backupId)}">${esc(b.backupId)} • ${esc(b.kind)} • ${esc(stamp(b.createdAt))}</option>`).join('');
  const backupRows=backups.map(b=>`<tr><td><b>${esc(b.backupId)}</b><small>${esc(b.kind)}</small></td><td>${esc(stamp(b.createdAt))}<small>${esc(b.actor)}</small></td><td>${b.totalEntries}</td><td>${fmtBytes(b.totalBytes)}</td><td><code>${esc(String(b.checksum||'').slice(0,14))}…</code></td><td><details><summary>Ajukan Restore</summary><form method="post" class="restore"><input type="hidden" name="action" value="restore"><input type="hidden" name="backupId" value="${esc(b.backupId)}"><input name="reason" placeholder="Alasan restore" required><input name="confirmation" placeholder="RESTORE ${esc(b.backupId)}" required><button class="danger">Ajukan ke Checker</button></form></details></td></tr>`).join('');
  const auditRows=audits.map(a=>`<tr><td>${esc(stamp(a.createdAt))}</td><td><b>${esc(a.actor)}</b><small>${esc(a.role)}</small></td><td>${esc(a.action)}</td><td>${esc(a.entityType)}<small>${esc(a.entityId||'—')}</small></td><td>${esc(a.status)}</td><td>${esc(a.note||'')}</td><td><code>${esc(String(a.recordHash||'').slice(0,12))}…</code></td></tr>`).join('');
  const planStores=recoveryPlan?.stores?.map(s=>`<tr><td>${esc(s.name)}</td><td>${s.count}</td><td>${fmtBytes(s.bytes)}</td><td>${s.immutable?'<span class="badge warn">REFERENCE ONLY</span>':'<span class="badge okb">RESTORABLE</span>'}</td><td><span class="badge okb">VERIFIED</span></td></tr>`).join('')||'';
  const planHtml=recoveryPlan?`<section class="card plan"><div class="head"><div><h2>Recovery Plan: ${esc(recoveryPlan.backupId)}</h2><small>Preview aman • belum melakukan restore</small></div><span class="badge okb">READY</span></div><div class="planGrid"><div><small>Sumber</small><b>${esc(recoveryPlan.source)}${recoveryPlan.imported?' → imported internal':''}</b></div><div><small>Manifest Checksum</small><b>VALID</b></div><div><small>Item diverifikasi</small><b>${recoveryPlan.checkedEntries}</b></div><div><small>Ukuran diverifikasi</small><b>${fmtBytes(recoveryPlan.checkedBytes)}</b></div><div><small>Dapat dipulihkan</small><b>${recoveryPlan.restorableEntries}</b></div><div><small>Reference-only</small><b>${recoveryPlan.immutableEntries}</b></div></div><div class="aiNote"><b>AI-safe mode:</b> backup mentah tidak dikirim ke OpenAI. Assistant hanya perlu metadata recovery seperti Backup ID, status checksum, jumlah store/item, dan hasil verifikasi. Dekripsi serta checksum tetap dilakukan di server Libra.</div><div class="tablewrap"><table><thead><tr><th>Store</th><th>Item</th><th>Ukuran</th><th>Restore Policy</th><th>Integritas</th></tr></thead><tbody>${planStores}</tbody></table></div><div class="planAction"><div><b>Langkah berikut:</b> jika plan ini benar, ajukan restore. Eksekusi tetap membutuhkan checker SUPERADMIN berbeda dan safety backup otomatis.</div><form method="post" class="restore"><input type="hidden" name="action" value="restore"><input type="hidden" name="backupId" value="${esc(recoveryPlan.backupId)}"><input name="reason" placeholder="Alasan restore" required><input name="confirmation" placeholder="RESTORE ${esc(recoveryPlan.backupId)}" required><button class="danger">Ajukan Restore ke Checker</button></form></div></section>`:'';

  return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Audit, Backup & DR | Libra</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f6fa;color:#10243d;font-family:Inter,system-ui}.top{background:#061d36;color:#fff;padding:18px}.topin,.wrap{max-width:1250px;margin:auto}.topin{display:flex;justify-content:space-between}.top a{color:#fff}.wrap{padding:24px 18px 50px}.hero{background:linear-gradient(135deg,#0b2d52,#0b476f);color:#fff;border-radius:20px;padding:24px}.hero p{color:#d9e6f2}.notice{padding:12px 14px;border-radius:10px;margin:14px 0}.ok{background:#e8f6ee;color:#176b37}.err{background:#fff0ef;color:#9e2621}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.stat,.card{background:#fff;border:1px solid #dce6ef;border-radius:15px}.stat{padding:15px}.stat small{display:block;color:#718397}.stat b{display:block;font-size:20px;margin-top:4px}.card{overflow:hidden;margin-top:18px}.head{padding:15px 17px;border-bottom:1px solid #e7eef4;display:flex;align-items:center;justify-content:space-between;gap:12px}.head h2{margin:0}.actions{display:flex;gap:8px;flex-wrap:wrap}input,button,select{font:inherit;padding:9px 11px;border:1px solid #cbd8e6;border-radius:9px}button{background:#0b2d52;color:#fff;border:0;font-weight:800;cursor:pointer}.danger{background:#a52e28}.tablewrap{overflow:auto}table{width:100%;min-width:950px;border-collapse:collapse;font-size:12px}th,td{padding:10px;border-bottom:1px solid #edf1f5;text-align:left;vertical-align:top}th{background:#f7fafc}small{display:block;color:#718397;margin-top:4px}code{font-family:ui-monospace,monospace}.restore{display:grid;gap:6px;margin-top:8px;min-width:270px}.policy{padding:15px;color:#5d7184;line-height:1.55}.nav{display:flex;gap:14px;flex-wrap:wrap;margin-top:16px}.nav a{font-weight:800;color:#0b426e}.assist{padding:18px;display:grid;grid-template-columns:1.2fr .7fr auto;gap:10px;align-items:end}.assist label small{margin-bottom:5px}.assist input,.assist select{width:100%}.assistInfo{padding:0 18px 18px;color:#5d7184;line-height:1.55}.badge{display:inline-block;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:850}.badge.okb{background:#dff3e7;color:#176b37}.badge.warn{background:#fff0ca;color:#74550a}.plan{border:2px solid #b8d8c4}.planGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:16px}.planGrid>div{border:1px solid #e3ebf1;border-radius:12px;padding:12px;background:#f9fbfd}.planGrid small{margin:0}.planGrid b{display:block;margin-top:5px}.aiNote{margin:0 16px 16px;padding:13px;border-radius:12px;background:#edf6ff;color:#244c6c;line-height:1.5}.planAction{display:grid;grid-template-columns:1fr minmax(280px,420px);gap:18px;align-items:start;padding:16px;border-top:1px solid #edf1f5}@media(max-width:760px){.summary{grid-template-columns:repeat(2,1fr)}.head{align-items:flex-start;flex-direction:column}.assist{grid-template-columns:1fr}.planGrid{grid-template-columns:repeat(2,1fr)}.planAction{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="topin"><strong>LIBRA JAYA LOGISTIC • Audit / Backup / DR</strong><a href="/libra-admin">← Home Admin</a></div></header><main class="wrap"><section class="hero"><h1>Audit Trail & Disaster Recovery</h1><p>Restore memakai <b>maker-checker dua SUPERADMIN berbeda</b>. AI Assisted Recovery hanya melakukan pencarian, import bila perlu, verifikasi checksum dan membuat recovery plan. Restore tidak berjalan sebelum approval checker. Safety backup tetap otomatis dibuat sebelum eksekusi.</p></section>${message?`<div class="notice ok">${esc(message)}</div>`:''}${error?`<div class="notice err">${esc(error)}</div>`:''}<section class="summary"><div class="stat"><small>Audit Chain</small><b>${chain.valid?'VALID':'BROKEN'}</b></div><div class="stat"><small>Audit Dicek</small><b>${chain.checked}</b></div><div class="stat"><small>Backup Tersimpan</small><b>${backups.length}</b></div><div class="stat"><small>Off-site</small><b>${offsite.configured?'CONFIGURED':'NOT CONFIGURED'}</b></div></section><section class="card"><div class="head"><div><h2>AI Assisted Recovery</h2><small>Temukan backup → verifikasi integritas → buat recovery plan → baru ajukan restore</small></div><span class="badge ${isSuperAdmin?'okb':'warn'}">${isSuperAdmin?'SUPERADMIN READY':'VIEW ONLY'}</span></div><form method="post" class="assist"><input type="hidden" name="action" value="assist_recovery"><label><small>Backup ID</small><input name="backupId" list="backup-list" placeholder="BKP-..." required ${isSuperAdmin?'':'disabled'}><datalist id="backup-list">${backupOptions}</datalist></label><label><small>Sumber</small><select name="source" ${isSuperAdmin?'':'disabled'}><option value="AUTO">AUTO (Internal → Off-site)</option><option value="INTERNAL">Internal saja</option><option value="OFFSITE">Off-site saja</option></select></label><button ${isSuperAdmin?'':'disabled'}>Verifikasi & Buat Plan</button></form><div class="assistInfo"><b>Proteksi privasi:</b> proses ini tidak mengirim isi backup ke OpenAI. Verifikasi dilakukan server-side memakai checksum SHA-256; off-site didekripsi di server Libra. Hanya metadata recovery yang aman yang boleh dipakai sebagai konteks assistant.</div></section>${planHtml}<section class="card"><div class="head"><div><h2>Backup Snapshot</h2><small>Scheduled ${policy.scheduledRetentionDays} hari • Manual/Pre-Restore ${policy.manualRetentionDays} hari</small></div><div class="actions"><form method="post"><input type="hidden" name="action" value="create_backup"><input name="reason" placeholder="Catatan backup"><button>Buat Backup Sekarang</button></form><form method="post"><input type="hidden" name="action" value="prune"><button>Jalankan Retention</button></form></div></div><div class="tablewrap"><table><thead><tr><th>Backup ID</th><th>Waktu</th><th>Item</th><th>Ukuran</th><th>Checksum</th><th>Recovery</th></tr></thead><tbody>${backupRows||'<tr><td colspan="6">Belum ada backup.</td></tr>'}</tbody></table></div><div class="policy">Protected stores: ${policy.protectedStores.map(esc).join(', ')}.<br>Restore mode: <b>${esc(policy.restoreMode)}</b>. ${esc(policy.notes)}</div></section><section class="card"><div class="head"><h2>Admin Audit Trail</h2><span>Hash-chain ${chain.valid?'✓ valid':`⚠ broken at ${esc(chain.brokenAt)}`}</span></div><div class="tablewrap"><table><thead><tr><th>Waktu</th><th>Admin</th><th>Aksi</th><th>Entity</th><th>Status</th><th>Catatan</th><th>Hash</th></tr></thead><tbody>${auditRows||'<tr><td colspan="7">Belum ada audit event.</td></tr>'}</tbody></table></div></section><div class="nav"><a href="/admin-approvals">Approval Center →</a><a href="/admin-resilience">Off-site Backup & External Alerts →</a></div></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
};
export const config={path:'/admin-audit-backup'};
