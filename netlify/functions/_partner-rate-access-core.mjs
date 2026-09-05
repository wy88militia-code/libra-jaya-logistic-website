import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { createOperationalNotification } from './_notification-core.mjs';

const STORE='libra-partner-rate-access';
const store=()=>getStore(STORE);
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const onlyDigits=v=>String(v??'').replace(/\D/g,'');
const now=()=>new Date().toISOString();
const NIB_RE=/^\d{13}$/;
const PHONE_RE=/^(?:62|0)8\d{7,12}$/;

function accessSecret(){const s=clean(process.env.PARTNER_RATE_ACCESS_SECRET||process.env.PARTNER_SESSION_SECRET,500);if(s.length<32)throw new Error('Pengamanan akses harga partner belum dikonfigurasi.');return s;}
function hmac(v){return crypto.createHmac('sha256',accessSecret()).update(v).digest('base64url');}
function b64(v){return Buffer.from(JSON.stringify(v)).toString('base64url');}
function fromB64(v){return JSON.parse(Buffer.from(v,'base64url').toString('utf8'));}
function safeEq(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function extractOutputText(data){if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text.trim();const out=[];for(const item of data?.output||[])for(const part of item?.content||[])if(part?.type==='output_text'&&part.text)out.push(part.text);return out.join('\n').trim();}
function parseJsonLoose(text){const raw=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(raw);}catch{const m=raw.match(/\{[\s\S]*\}/);if(!m)return null;try{return JSON.parse(m[0]);}catch{return null;}}}
function normalizeCompany(v){return clean(v,180).toUpperCase().replace(/\s+/g,' ');}

export function validateRateApplicant(body={}){
 const companyName=clean(body.companyName,180),picName=clean(body.picName,120),phone=onlyDigits(body.phone),nib=onlyDigits(body.nib),consent=body.consent===true||body.consent==='true'||body.consent==='on';
 if(companyName.length<3)throw new Error('Nama perusahaan wajib diisi.');
 if(!NIB_RE.test(nib))throw new Error('NIB wajib 13 digit.');
 if(picName.length<2)throw new Error('Nama PIC wajib diisi.');
 if(!PHONE_RE.test(phone))throw new Error('Nomor HP PIC tidak valid. Gunakan nomor Indonesia aktif.');
 if(!consent)throw new Error('Persetujuan verifikasi NIB wajib dicentang.');
 return {companyName,picName,phone,nib,consent};
}

async function verifyWithAiWeb({companyName,nib}){
 const apiKey=clean(process.env.OPENAI_API_KEY,500);if(!apiKey)return {status:'REVIEW',confidence:0,reason:'OPENAI_API_KEY belum tersedia untuk verifikasi web.',officialMatch:false,logisticsMatch:false,sources:[],raw:null};
 const model=clean(process.env.LIBRA_NIB_VERIFY_MODEL||process.env.LIBRA_AI_MODEL||'gpt-5.6-luna',80);
 const instructions=`Anda memverifikasi calon partner perusahaan logistik PT Libra Jaya Logistic. Gunakan web search. Prioritaskan sumber resmi Indonesia, terutama oss.go.id dan ahu.go.id. Jangan menebak. NIB adalah 13 digit. Cocokkan NIB dan nama badan usaha. Tentukan apakah kegiatan usahanya termasuk logistik/transportasi/pergudangan/freight forwarding/JPT/cargo/kurir atau jasa penunjang angkutan. Jika bukti resmi tidak cukup, status harus REVIEW, bukan REJECTED. REJECTED hanya bila ada bukti resmi kuat bahwa NIB/nama tidak cocok atau kegiatan jelas bukan bidang logistik terkait. Kembalikan HANYA JSON valid: {"status":"VERIFIED|REVIEW|REJECTED","officialMatch":true|false,"logisticsMatch":true|false,"companyNameFound":"...","nibFound":"...","kbli":["..."],"reason":"...","confidence":0-1,"sources":[{"title":"...","url":"...","official":true|false}]}. Jangan masukkan data pribadi lain.`;
 const input=`Verifikasi calon partner. Nama perusahaan yang diisi: ${normalizeCompany(companyName)}. NIB: ${nib}.`;
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({model,instructions,input,tools:[{type:'web_search',filters:{allowed_domains:['oss.go.id','ahu.go.id']},search_context_size:'medium'}],max_output_tokens:900})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(clean(data?.error?.message||`OpenAI HTTP ${response.status}`,400));
  const parsed=parseJsonLoose(extractOutputText(data));if(!parsed)throw new Error('Output verifikasi AI tidak dapat dibaca.');
  const status=['VERIFIED','REVIEW','REJECTED'].includes(String(parsed.status||'').toUpperCase())?String(parsed.status).toUpperCase():'REVIEW';
  const sources=Array.isArray(parsed.sources)?parsed.sources.slice(0,8).map(x=>({title:clean(x?.title,160),url:clean(x?.url,500),official:Boolean(x?.official)})):[];
  const officialMatch=Boolean(parsed.officialMatch),logisticsMatch=Boolean(parsed.logisticsMatch),confidence=Math.max(0,Math.min(1,Number(parsed.confidence)||0));
  const finalStatus=status==='VERIFIED'&&officialMatch&&logisticsMatch&&confidence>=0.8?'VERIFIED':status==='REJECTED'&&confidence>=0.9?'REJECTED':'REVIEW';
  return {status:finalStatus,officialMatch,logisticsMatch,companyNameFound:clean(parsed.companyNameFound,180),nibFound:onlyDigits(parsed.nibFound),kbli:Array.isArray(parsed.kbli)?parsed.kbli.slice(0,20).map(x=>clean(x,80)):[],reason:clean(parsed.reason,700),confidence,sources,model,responseId:clean(data.id,120)||null};
 }catch(error){return {status:'REVIEW',officialMatch:false,logisticsMatch:false,companyNameFound:'',nibFound:'',kbli:[],reason:`Verifikasi web belum dapat dipastikan: ${clean(error?.message||error,400)}`,confidence:0,sources:[],model,error:clean(error?.message||error,500)};}
}

export async function submitRateApplicant(body={}){
 const applicant=validateRateApplicant(body),verification=await verifyWithAiWeb({companyName:applicant.companyName,nib:applicant.nib}),createdAt=now(),leadId=`RATE-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
 const record={leadId,createdAt,updatedAt:createdAt,status:verification.status,companyName:applicant.companyName,nib:applicant.nib,picName:applicant.picName,phone:applicant.phone,consent:true,verification};
 await store().setJSON(`lead/${createdAt}-${leadId}`,record,{onlyIfNew:true});await store().setJSON(`nib/${applicant.nib}/${leadId}`,record,{onlyIfNew:true}).catch(()=>{});
 try{await createOperationalNotification({type:'PARTNER_RATE_ACCESS',severity:verification.status==='VERIFIED'?'INFO':verification.status==='REJECTED'?'WARNING':'INFO',title:verification.status==='VERIFIED'?'Calon partner lolos verifikasi harga':'Permintaan akses harga perlu review',message:`${applicant.companyName} • NIB ${applicant.nib} • ${verification.status}. ${verification.reason}`,notifyPartner:false,notifyAdmin:true,adminLink:'/admin-api-onboarding',dedupeKey:`partner-rate:${applicant.nib}:${verification.status}`,metadata:{leadId,nib:applicant.nib,companyName:applicant.companyName,status:verification.status,confidence:verification.confidence}});}catch{}
 return record;
}

export function issueRateAccess(record,{hours=24}={}){if(record?.status!=='VERIFIED')return null;const payload={v:1,nib:record.nib,companyName:record.companyName,verifiedAt:record.updatedAt||record.createdAt,exp:Math.floor(Date.now()/1000)+Math.max(1,Math.min(Number(hours)||24,72))*3600};const encoded=b64(payload);return `${encoded}.${hmac(encoded)}`;}
export function verifyRateAccess(token){try{const [encoded,sig]=String(token||'').split('.');if(!encoded||!sig||!safeEq(sig,hmac(encoded)))return null;const p=fromB64(encoded);if(p?.v!==1||!NIB_RE.test(String(p.nib||''))||Number(p.exp||0)<=Math.floor(Date.now()/1000))return null;return p;}catch{return null;}}
