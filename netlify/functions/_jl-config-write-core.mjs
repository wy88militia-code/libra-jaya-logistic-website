import crypto from 'node:crypto';
import { getJlPricingConfigSnapshot } from './_jl-master-core.mjs';
import { writeAdminAudit } from './_admin-audit-core.mjs';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const SHEET='JL_CONFIG';
const clean=(v,n=240)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const normalizeKey=v=>String(v||'').replace(/\\n/g,'\n').trim();
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const num=v=>Number.isFinite(Number(v))?Number(v):null;

function config(){return {sheetId:process.env.MASTER_SHEET_ID||DEFAULT_SHEET_ID,email:clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),privateKey:normalizeKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)};}
async function accessToken(){
  const c=config();if(!c.email||!c.privateKey)throw new Error('Google Service Account belum dikonfigurasi.');
  const now=Math.floor(Date.now()/1000),header=b64({alg:'RS256',typ:'JWT'}),payload=b64({iss:c.email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),unsigned=`${header}.${payload}`;
  const signer=crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();const assertion=`${unsigned}.${signer.sign(c.privateKey).toString('base64url')}`;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})}),j=await r.json();if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||'Gagal memperoleh token Google Sheets.');return j.access_token;
}
async function configRows(token){
  const c=config(),range=encodeURIComponent(`'${SHEET}'!A1:F200`),r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.sheetId)}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,{headers:{authorization:`Bearer ${token}`}}),j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Gagal membaca JL_CONFIG.');return j.values||[];
}
function findMarginRow(rows=[]){
  for(let i=1;i<rows.length;i+=1){const row=rows[i]||[];if(upper(row[0])==='MARGINS'&&clean(row[1])==='portToPort'){const editable=row[5]===true||['TRUE','YES','1'].includes(upper(row[5]));return {rowNumber:i+1,current:num(row[2]),editable};}}
  return null;
}

export async function setJlPortToPortMargin({marginPct,session,request,note}={}){
  if(String(session?.role||'').toUpperCase()!=='SUPERADMIN'){const e=new Error('Hanya SUPERADMIN yang dapat mengubah margin PTP.');e.httpStatus=403;throw e;}
  const requested=num(marginPct);if(!(requested>0&&requested<=60))throw new Error('Margin PTP harus >0% dan maksimal 60%.');
  const normalized=Math.round(requested*100)/100,token=await accessToken(),rows=await configRows(token),target=findMarginRow(rows);if(!target)throw new Error('Baris MARGINS / portToPort tidak ditemukan di JL_CONFIG.');if(!target.editable)throw new Error('MARGINS / portToPort ditandai tidak editable di JL_CONFIG.');
  const before=await getJlPricingConfigSnapshot();if(Math.abs(Number(before.margins.portToPort||0)-normalized)<0.0001)return {changed:false,idempotent:true,before,after:before,rowNumber:target.rowNumber};
  const c=config(),range=`'${SHEET}'!C${target.rowNumber}`,resp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,{method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({range,majorDimension:'ROWS',values:[[normalized]]})}),body=await resp.json();if(!resp.ok)throw new Error(body?.error?.message||'Gagal menulis margin PTP ke JL_CONFIG.');
  const after=await getJlPricingConfigSnapshot();if(Math.abs(Number(after.margins.portToPort||0)-normalized)>0.0001)throw new Error('Write-back margin PTP tidak lolos read-back verification.');
  await writeAdminAudit({session,request,action:'JL_PTP_MARGIN_UPDATE',entityType:'JL_CONFIG',entityId:'MARGINS.portToPort',before:{marginPct:before.margins.portToPort,portToPortSellConfigured:before.portToPortSellConfigured},after:{marginPct:after.margins.portToPort,portToPortSellConfigured:after.portToPortSellConfigured},note:clean(note,500)||'Approval margin PTP Tahap 1 CGK-DJJ',metadata:{sheetId:c.sheetId,sheet:SHEET,rowNumber:target.rowNumber,readBackVerified:true}});
  return {changed:true,rowNumber:target.rowNumber,before,after};
}
