import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getAdminSession } from './_partner-core.mjs';

const AUDIT_STORE='libra-admin-audit';
const ROLE_PERMISSIONS={
  SUPERADMIN:['*'],
  ADMIN:['PARTNER_WRITE','MASTER_READ','MASTER_PUBLISH','QUOTE_APPROVE','BOOKING_READ','TRACKING_WRITE','CLAIM_READ','API_ADMIN','AUDIT_READ'],
  OPS:['MASTER_READ','QUOTE_APPROVE','BOOKING_READ','TRACKING_WRITE','CLAIM_READ'],
  COURIER:['BOOKING_READ','TRACKING_WRITE'],
  FINANCE:['PARTNER_WRITE','QUOTE_APPROVE','BOOKING_READ'],
  API_ADMIN:['PARTNER_WRITE','API_ADMIN'],
  VIEWER:['MASTER_READ','BOOKING_READ','CLAIM_READ'],
};

export function hasPermission(session,permission){
  if(!session)return false;
  const role=String(session.role||'').toUpperCase();
  const permissions=ROLE_PERMISSIONS[role]||[];
  return permissions.includes('*')||permissions.includes(permission);
}

export function requireAdminPermission(request,permission){
  const session=getAdminSession(request);
  if(!session)return {ok:false,status:401,session:null};
  if(!hasPermission(session,permission))return {ok:false,status:403,session};
  return {ok:true,status:200,session};
}

export function adminDeniedResponse(request,result){
  if(result?.status===401)return Response.redirect(new URL('/admin-login.html',request.url),302);
  return new Response('<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Akses Ditolak</title></head><body style="font-family:system-ui;padding:30px"><h1>Akses ditolak</h1><p>Role admin ini tidak memiliki izin untuk modul tersebut.</p><a href="/admin-tool">← Home Admin</a></body></html>',{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}

function clientIp(request){return String(request.headers.get('x-nf-client-connection-ip')||request.headers.get('x-forwarded-for')||'').split(',')[0].trim().slice(0,80);}
export async function auditAdmin(request,session,{action,target=null,details=null,result='SUCCESS'}={}){
  if(!session)return;
  const createdAt=new Date().toISOString();
  const auditId=`AUD-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const row={auditId,username:session.username||'unknown',role:session.role||'UNKNOWN',action:String(action||'UNKNOWN').slice(0,120),target:target?String(target).slice(0,180):null,result:String(result||'SUCCESS').slice(0,40),details:details&&typeof details==='object'?details:{message:details?String(details).slice(0,800):null},ip:clientIp(request),userAgent:String(request.headers.get('user-agent')||'').slice(0,250),createdAt};
  await getStore(AUDIT_STORE).setJSON(`event/${createdAt}-${auditId}`,row,{onlyIfNew:true});
}

export async function listAdminAudit(limit=500){
  const store=getStore(AUDIT_STORE);const {blobs}=await store.list({prefix:'event/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(limit,1500)));const rows=[];for(const blob of selected){const row=await store.get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;
}

export function permissionsForRole(role){return ROLE_PERMISSIONS[String(role||'').toUpperCase()]||[];}
