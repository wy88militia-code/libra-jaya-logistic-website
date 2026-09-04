import { getStore } from '@netlify/blobs';

const STORE='libra-accurate-sync';
const store=()=>getStore(STORE);
const now=()=>new Date().toISOString();
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);

async function findJobEntry(jobId){
 const id=String(jobId||'').trim();
 if(!id)throw new Error('Job ID wajib diisi.');
 const {blobs}=await store().list({prefix:'job/'});
 for(const blob of blobs){
  const entry=await store().getWithMetadata(blob.key,{type:'json',consistency:'strong'});
  if(entry?.data?.jobId===id)return {key:blob.key,...entry};
 }
 return null;
}

export async function archiveAccurateQueueJob(jobId,actor='admin',reason='Dibatalkan dari Accurate Sync Queue'){
 const entry=await findJobEntry(jobId);
 if(!entry?.data)throw new Error('Accurate queue job tidak ditemukan.');
 const current=entry.data;
 if(current.liveUat)throw new Error('Job UAT tidak dihapus dari sini. UAT disimpan sebagai bukti pengujian dan tidak ditampilkan di Sync Queue production.');
 if(current.status==='ARCHIVED')return current;
 const blocked=['POSTED','POSTING','RECONCILE_REQUIRED','APPROVAL_PENDING'];
 if(blocked.includes(String(current.status||'')))throw new Error(`Job status ${current.status} tidak boleh diarsipkan. Selesaikan proses/reconcile/approval terlebih dahulu.`);
 const allowed=['READY_FOR_REVIEW','NEEDS_MAPPING','POST_FAILED'];
 if(!allowed.includes(String(current.status||'')))throw new Error(`Job status ${current.status||'-'} belum diizinkan untuk arsip.`);
 const next={...current,status:'ARCHIVED',archivedAt:now(),archivedBy:clean(actor,100),archiveReason:clean(reason,500)||'Dibatalkan dari Accurate Sync Queue',updatedAt:now()};
 const result=await store().setJSON(entry.key,next,{onlyIfMatch:entry.etag});
 if(!result.modified)throw new Error('Queue berubah di proses lain. Refresh lalu coba lagi.');
 return next;
}
