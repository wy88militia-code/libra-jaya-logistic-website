import { getStore } from '@netlify/blobs';

const STORE='libra-system-heartbeats';
const store=()=>getStore(STORE);
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const now=()=>new Date().toISOString();
const key=name=>`heartbeat/${clean(name,80).toUpperCase().replace(/[^A-Z0-9_-]/g,'_')}`;

export async function markSystemHeartbeat(name,{status='OK',message='',metadata=null}={}){
  const heartbeat={name:clean(name,80).toUpperCase(),status:String(status||'OK').toUpperCase()==='ERROR'?'ERROR':'OK',message:clean(message,500)||null,metadata:metadata&&typeof metadata==='object'?metadata:null,at:now()};
  await store().setJSON(key(name),heartbeat);
  return heartbeat;
}

export async function getSystemHeartbeat(name){return store().get(key(name),{type:'json',consistency:'strong'});}

export async function listSystemHeartbeats(){
  const {blobs}=await store().list({prefix:'heartbeat/'}),rows=[];
  for(const blob of blobs){const row=await store().get(blob.key,{type:'json'});if(row)rows.push(row);}
  return rows.sort((a,b)=>String(a.name).localeCompare(String(b.name)));
}

export function heartbeatAgeMinutes(row){const t=new Date(row?.at||0).getTime();return Number.isFinite(t)&&t>0?Math.round((Date.now()-t)/6000)/10:null;}
