import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';

const BACKUP_STORE='libra-backups';
const PROTECTED_STORES=['libra-partners','libra-wallets','libra-bookings','libra-quotes','libra-tracking','libra-pod','libra-api-uat','libra-api-onboarding','libra-rate-plans','libra-api-policies','libra-master-sync','libra-webhook-deliveries','libra-notifications','libra-admin-audit'];
const IMMUTABLE_ON_RESTORE=new Set(['libra-admin-audit']);
const EXCLUDED_PREFIXES=new Map([['libra-partners',['apikey/']]]);
const now=()=>new Date().toISOString();
const backupStore=()=>getStore(BACKUP_STORE);
const integer=(value,fallback,min,max)=>{const n=Math.trunc(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;};
const scheduledRetentionDays=()=>integer(process.env.BACKUP_RETENTION_DAYS,30,7,365);
const manualRetentionDays=()=>integer(process.env.BACKUP_MANUAL_RETENTION_DAYS,90,14,730);

async function captureStore(name){
  const s=getStore(name);const {blobs}=await s.list();const excluded=EXCLUDED_PREFIXES.get(name)||[];const entries=[];
  for(const blob of blobs){if(excluded.some(prefix=>blob.key.startsWith(prefix)))continue;const bytes=await s.get(blob.key,{type:'arrayBuffer',consistency:'strong'});if(bytes===null||bytes===undefined)continue;const buffer=Buffer.from(bytes);entries.push({key:blob.key,size:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),base64:buffer.toString('base64')});}
  return {name,count:entries.length,entries};
}
export async function createBackup({kind='MANUAL',actor='system',reason=''}={}){
  const backupId=`BKP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;const createdAt=now();const stores=[];let totalEntries=0,totalBytes=0;
  for(const name of PROTECTED_STORES){const snapshot=await captureStore(name);stores.push(snapshot);totalEntries+=snapshot.count;totalBytes+=snapshot.entries.reduce((sum,e)=>sum+e.size,0);}
  const manifest={backupId,kind:String(kind).toUpperCase(),actor:String(actor||'system').slice(0,100),reason:String(reason||'').slice(0,500),createdAt,totalEntries,totalBytes,stores};const checksum=crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');const record={...manifest,checksum};const key=`backup/${createdAt}-${backupId}`;await backupStore().setJSON(key,record,{onlyIfNew:true});await backupStore().setJSON(`index/${backupId}`,{backupId,key,kind:record.kind,actor:record.actor,reason:record.reason,createdAt,totalEntries,totalBytes,checksum},{onlyIfNew:true});return record;
}
export async function listBackups(limit=100){const {blobs}=await backupStore().list({prefix:'index/'});const rows=[];for(const blob of blobs.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,Math.max(1,Math.min(limit,300)))){const row=await backupStore().get(blob.key,{type:'json'});if(row)rows.push(row);}return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
export async function getBackup(backupId){const index=await backupStore().get(`index/${String(backupId||'').trim()}`,{type:'json',consistency:'strong'});if(!index)return null;return backupStore().get(index.key,{type:'json',consistency:'strong'});}
export async function pruneBackups(){const rows=await listBackups(300);const current=Date.now();let deleted=0;for(const row of rows){const ageDays=(current-new Date(row.createdAt).getTime())/86400000;const retention=row.kind==='SCHEDULED'?scheduledRetentionDays():manualRetentionDays();if(ageDays<=retention)continue;await backupStore().delete(row.key);await backupStore().delete(`index/${row.backupId}`);deleted+=1;}return {deleted,scheduledRetentionDays:scheduledRetentionDays(),manualRetentionDays:manualRetentionDays()};}
export async function restoreBackup(backupId,{actor='admin',reason=''}={}){
  const backup=await getBackup(backupId);if(!backup)throw new Error('Backup tidak ditemukan.');const expected=backup.checksum;const {checksum,...raw}=backup;const actual=crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex');if(expected!==actual)throw new Error('Checksum backup tidak valid. Restore dibatalkan.');
  const safety=await createBackup({kind:'PRE_RESTORE',actor,reason:`Safety snapshot sebelum restore ${backupId}. ${reason}`});let restored=0,skippedImmutable=0;
  for(const snapshot of backup.stores||[]){if(!PROTECTED_STORES.includes(snapshot.name))continue;if(IMMUTABLE_ON_RESTORE.has(snapshot.name)){skippedImmutable+=snapshot.entries?.length||0;continue;}const s=getStore(snapshot.name);for(const entry of snapshot.entries||[]){const bytes=Buffer.from(entry.base64,'base64');const digest=crypto.createHash('sha256').update(bytes).digest('hex');if(digest!==entry.sha256)throw new Error(`Checksum entry gagal: ${snapshot.name}/${entry.key}`);await s.set(entry.key,bytes);restored+=1;}}
  return {backupId,restored,skippedImmutable,safetyBackupId:safety.backupId,restoredAt:now()};
}
export function backupPolicy(){return {protectedStores:[...PROTECTED_STORES],immutableOnRestore:[...IMMUTABLE_ON_RESTORE],scheduledRetentionDays:scheduledRetentionDays(),manualRetentionDays:manualRetentionDays(),restoreMode:'NON_DESTRUCTIVE_OVERWRITE',notes:'Restore menimpa key yang ada di snapshot tetapi tidak menghapus key baru. Audit trail ikut diarsipkan ke backup tetapi tidak pernah direwind saat restore.'};}
