import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { getStore } from '@netlify/blobs';

const gzip=promisify(zlib.gzip);
const gunzip=promisify(zlib.gunzip);
const BACKUP_STORE='libra-backups';
const backupStore=()=>getStore(BACKUP_STORE);
const now=()=>new Date().toISOString();
const clean=(value,max=500)=>String(value??'').trim().slice(0,max);
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const hmac=(key,value,encoding=null)=>{const digest=crypto.createHmac('sha256',key).update(value);return encoding?digest.digest(encoding):digest.digest();};
const rfc3986=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath=value=>String(value||'').split('/').map(rfc3986).join('/');

function config(){
  const endpoint=clean(process.env.OFFSITE_S3_ENDPOINT,500).replace(/\/$/,'');
  const bucket=clean(process.env.OFFSITE_S3_BUCKET,120);
  const region=clean(process.env.OFFSITE_S3_REGION,80)||'auto';
  const accessKeyId=clean(process.env.OFFSITE_S3_ACCESS_KEY_ID,200);
  const secretAccessKey=String(process.env.OFFSITE_S3_SECRET_ACCESS_KEY||'').trim();
  const encryptionKeyB64=String(process.env.OFFSITE_BACKUP_ENCRYPTION_KEY_B64||'').trim();
  const prefix=(clean(process.env.OFFSITE_BACKUP_PREFIX,200)||'libra-jaya').replace(/^\/+|\/+$/g,'');
  const missing=[];
  if(!endpoint)missing.push('OFFSITE_S3_ENDPOINT');
  if(!bucket)missing.push('OFFSITE_S3_BUCKET');
  if(!accessKeyId)missing.push('OFFSITE_S3_ACCESS_KEY_ID');
  if(!secretAccessKey)missing.push('OFFSITE_S3_SECRET_ACCESS_KEY');
  if(!encryptionKeyB64)missing.push('OFFSITE_BACKUP_ENCRYPTION_KEY_B64');
  return {endpoint,bucket,region,accessKeyId,secretAccessKey,encryptionKeyB64,prefix,configured:missing.length===0,missing};
}
function encryptionKey(cfg){let key;try{key=Buffer.from(cfg.encryptionKeyB64,'base64');}catch{throw new Error('OFFSITE_BACKUP_ENCRYPTION_KEY_B64 tidak valid.');}if(key.length!==32)throw new Error('OFFSITE_BACKUP_ENCRYPTION_KEY_B64 harus mewakili tepat 32 byte untuk AES-256-GCM.');return key;}
function objectKeyFor(backupId,cfg=config()){return `${cfg.prefix}/backups/${clean(backupId,100)}.lbrbk`;}
function endpointUrl(cfg,key){let base;try{base=new URL(cfg.endpoint);}catch{throw new Error('OFFSITE_S3_ENDPOINT tidak valid.');}if(base.protocol!=='https:')throw new Error('OFFSITE_S3_ENDPOINT wajib HTTPS.');const basePath=base.pathname.replace(/\/+$/,'');const rawPath=`${basePath}/${cfg.bucket}/${key}`.replace(/\/{2,}/g,'/');base.pathname=rawPath;base.search='';base.hash='';return base;}
function amzTimestamp(date=new Date()){const iso=date.toISOString().replace(/[:-]|\.\d{3}/g,'');return {amzDate:iso,dateStamp:iso.slice(0,8)};}
function signingKey(secret,dateStamp,region){const kDate=hmac(Buffer.from(`AWS4${secret}`),dateStamp);const kRegion=hmac(kDate,region);const kService=hmac(kRegion,'s3');return hmac(kService,'aws4_request');}
async function signedS3Request(method,key,body=Buffer.alloc(0),extraHeaders={}){
  const cfg=config();if(!cfg.configured)throw new Error(`Off-site backup belum dikonfigurasi: ${cfg.missing.join(', ')}`);
  const url=endpointUrl(cfg,key);const payload=Buffer.isBuffer(body)?body:Buffer.from(body||'');const payloadHash=sha256(payload);const {amzDate,dateStamp}=amzTimestamp();
  const canonicalUri=encodePath(url.pathname);const canonicalHeaders=`host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;const signedHeaders='host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest=`${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;const scope=`${dateStamp}/${cfg.region}/s3/aws4_request`;const stringToSign=`AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(Buffer.from(canonicalRequest))}`;const signature=hmac(signingKey(cfg.secretAccessKey,dateStamp,cfg.region),stringToSign,'hex');
  const authorization=`AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(url,{method,headers:{authorization,'x-amz-date':amzDate,'x-amz-content-sha256':payloadHash,...extraHeaders},body:['GET','HEAD'].includes(method)?undefined:payload,redirect:'error'});
}
async function encryptBackup(backup){const cfg=config();const key=encryptionKey(cfg);const plain=Buffer.from(JSON.stringify(backup));const compressed=await gzip(plain,{level:9});const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(compressed),cipher.final()]);const tag=cipher.getAuthTag();const envelope={version:1,format:'LIBRA_OFFSITE_BACKUP',algorithm:'AES-256-GCM',compression:'gzip',backupId:backup.backupId,createdAt:backup.createdAt,plaintextSha256:sha256(plain),compressedSha256:sha256(compressed),iv:iv.toString('base64'),tag:tag.toString('base64'),ciphertext:ciphertext.toString('base64')};return Buffer.from(JSON.stringify(envelope));}
async function decryptBackup(bytes){const cfg=config();const key=encryptionKey(cfg);let envelope;try{envelope=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw new Error('Format off-site backup tidak valid.');}if(envelope?.format!=='LIBRA_OFFSITE_BACKUP'||Number(envelope?.version)!==1||envelope?.algorithm!=='AES-256-GCM')throw new Error('Format/versi off-site backup tidak didukung.');const iv=Buffer.from(String(envelope.iv||''),'base64'),tag=Buffer.from(String(envelope.tag||''),'base64'),ciphertext=Buffer.from(String(envelope.ciphertext||''),'base64');if(iv.length!==12||tag.length!==16)throw new Error('Metadata enkripsi off-site backup tidak valid.');let compressed;try{const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);compressed=Buffer.concat([decipher.update(ciphertext),decipher.final()]);}catch{throw new Error('Dekripsi off-site backup gagal. Periksa encryption key atau integritas file.');}if(sha256(compressed)!==envelope.compressedSha256)throw new Error('Checksum compressed off-site backup tidak cocok.');const plain=await gunzip(compressed);if(sha256(plain)!==envelope.plaintextSha256)throw new Error('Checksum plaintext off-site backup tidak cocok.');let backup;try{backup=JSON.parse(plain.toString('utf8'));}catch{throw new Error('Payload off-site backup tidak dapat dibaca.');}if(backup.backupId!==envelope.backupId)throw new Error('Backup ID off-site tidak cocok dengan envelope.');const {checksum,...raw}=backup;if(sha256(Buffer.from(JSON.stringify(raw)))!==checksum)throw new Error('Checksum manifest backup tidak valid.');return backup;}
async function updateIndex(backupId,patch){const key=`index/${clean(backupId,100)}`;const current=await backupStore().get(key,{type:'json',consistency:'strong'});if(!current)return null;const next={...current,...patch,updatedAt:now()};await backupStore().setJSON(key,next);return next;}

export function offsiteBackupConfig(){const cfg=config();let endpointHost=null;try{endpointHost=cfg.endpoint?new URL(cfg.endpoint).host:null;}catch{}return {configured:cfg.configured,missing:cfg.missing,endpoint:endpointHost,bucket:cfg.bucket||null,region:cfg.region,prefix:cfg.prefix,encryption:'AES-256-GCM + gzip',objectPattern:`${cfg.prefix}/backups/<BACKUP_ID>.lbrbk`};}
export async function uploadOffsiteBackup(backup){if(!backup?.backupId)throw new Error('Backup tidak valid untuk upload off-site.');const cfg=config();if(!cfg.configured)throw new Error(`Off-site backup belum dikonfigurasi: ${cfg.missing.join(', ')}`);const key=objectKeyFor(backup.backupId,cfg);const encrypted=await encryptBackup(backup);try{const response=await signedS3Request('PUT',key,encrypted,{'content-type':'application/octet-stream'});if(!response.ok){const text=(await response.text().catch(()=>'' )).slice(0,500);throw new Error(`S3-compatible upload gagal HTTP ${response.status}${text?`: ${text}`:''}`);}const result={status:'UPLOADED',provider:'S3_COMPATIBLE',objectKey:key,uploadedAt:now(),encryptedBytes:encrypted.length,etag:response.headers.get('etag')||null};await updateIndex(backup.backupId,{offsite:result});return result;}catch(error){const failed={status:'FAILED',provider:'S3_COMPATIBLE',objectKey:key,failedAt:now(),error:String(error?.message||error).slice(0,500)};await updateIndex(backup.backupId,{offsite:failed});throw error;}}
export async function downloadOffsiteBackup(backupId){const cfg=config();if(!cfg.configured)throw new Error(`Off-site backup belum dikonfigurasi: ${cfg.missing.join(', ')}`);const key=objectKeyFor(backupId,cfg);const response=await signedS3Request('GET',key);if(response.status===404)throw new Error(`Off-site backup ${backupId} tidak ditemukan.`);if(!response.ok){const text=(await response.text().catch(()=>'' )).slice(0,500);throw new Error(`Download off-site backup gagal HTTP ${response.status}${text?`: ${text}`:''}`);}const backup=await decryptBackup(Buffer.from(await response.arrayBuffer()));if(backup.backupId!==clean(backupId,100))throw new Error('Backup ID hasil download tidak sesuai permintaan.');return {backup,objectKey:key,downloadedAt:now()};}
export async function importOffsiteBackup(backupId){const {backup,objectKey}=await downloadOffsiteBackup(backupId);const key=`backup/${backup.createdAt}-${backup.backupId}`;await backupStore().setJSON(key,backup);const existing=await backupStore().get(`index/${backup.backupId}`,{type:'json',consistency:'strong'});const index={...(existing||{}),backupId:backup.backupId,key,kind:backup.kind,actor:backup.actor,reason:backup.reason,createdAt:backup.createdAt,totalEntries:backup.totalEntries,totalBytes:backup.totalBytes,checksum:backup.checksum,offsite:{status:'IMPORTED',provider:'S3_COMPATIBLE',objectKey,importedAt:now()}};await backupStore().setJSON(`index/${backup.backupId}`,index);return {backup,index};}
