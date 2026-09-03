import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const STORE_NAME='libra-admin-audit';
const store=()=>getStore(STORE_NAME);
const now=()=>new Date().toISOString();
const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const secretKey=/secret|token|pin(hash|salt)?|password|authorization|signature|private.?key|api.?key/i;
function sanitize(value,depth=0){if(depth>6)return '[TRUNCATED]';if(Array.isArray(value))return value.slice(0,100).map(v=>sanitize(v,depth+1));if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value))out[k]=secretKey.test(k)?'[REDACTED]':sanitize(v,depth+1);return out;}if(typeof value==='string')return value.slice(0,3000);if(['number','boolean'].includes(typeof value)||value===null)return value;return value===undefined?null:String(value).slice(0,1000);}
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value);}
function hashRecord(record){return crypto.createHash('sha256').update(canonical(record)).digest('hex');}
function requestMeta(request){if(!request)return {ip:null,userAgent:null,path:null,method:null};const forwarded=String(request.headers.get('x-nf-client-connection-ip')||request.headers.get('x-forwarded-for')||'').split(',')[0].trim();let path=null;try{const u=new URL(request.url);path=`${u.pathname}${u.search}`;}catch{}return {ip:forwarded.slice(0,100)||null,userAgent:clean(request.headers.get('user-agent'),300)||null,path,method:clean(request.method,12)||null};}

export async function writeAdminAudit({session,request,action,entityType,entityId,before=null,after=null,status='SUCCESS',note=null,metadata=null}={}){
 const actor=clean(session?.username||'unknown',100),role=clean(session?.role||'UNKNOWN',80),createdAt=now(),auditId=`AUD-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;const base={auditId,createdAt,actor,role,action:clean(action,120),entityType:clean(entityType,100),entityId:clean(entityId,180)||null,status:clean(status,30)||'SUCCESS',note:clean(note,1000)||null,request:requestMeta(request),before:sanitize(before),after:sanitize(after),metadata:sanitize(metadata)};const s=store();const eventKey=`event/${createdAt}-${auditId}`;
 for(let attempt=0;attempt<8;attempt+=1){const headEntry=await s.getWithMetadata('head/current',{type:'json',consistency:'strong'});const prev=headEntry?.data||{hash:null,auditId:null};const record={...base,prevHash:prev.hash||null};const recordHash=hashRecord(record);await s.setJSON(eventKey,{...record,recordHash});const result=await s.setJSON('head/current',{auditId,hash:recordHash,createdAt},headEntry?{onlyIfMatch:headEntry.etag}:{onlyIfNew:true});if(result.modified)return {...record,recordHash};await s.delete(eventKey);}
 throw new Error('Audit trail sedang sibuk. Perubahan utama sudah diproses tetapi audit perlu dicek.');
}
export async function listAdminAudit(limit=300){const {blobs}=await store().list({prefix:'event/'});const selected=blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(Number(limit)||300,1000)));const rows=[];for(const blob of selected){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows;}
export async function verifyAuditChain(limit=1000){
 const rows=(await listAdminAudit(limit)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));const head=await store().get('head/current',{type:'json',consistency:'strong'});let prevHash=rows[0]?.prevHash||null,valid=true,brokenAt=null;
 for(const row of rows){const {recordHash,...record}=row;const calculated=hashRecord(record);if(calculated!==recordHash||record.prevHash!==prevHash){valid=false;brokenAt=row.auditId;break;}prevHash=recordHash;}
 if(valid&&rows.length&&head?.hash!==prevHash){valid=false;brokenAt='HEAD_MISMATCH';}
 if(valid&&!rows.length&&head?.hash){valid=false;brokenAt='HEAD_WITHOUT_EVENTS';}
 return {valid,checked:rows.length,brokenAt,lastHash:prevHash,headHash:head?.hash||null};
}
