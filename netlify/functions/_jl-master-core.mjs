import crypto from 'node:crypto';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const clean=(v,n=240)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const num=(v,fallback=null)=>Number.isFinite(Number(v))?Number(v):fallback;
const bool=v=>v===true||['TRUE','YES','1','ACTIVE'].includes(upper(v));
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const normalizeKey=v=>String(v||'').replace(/\\n/g,'\n').trim();

function config(){return {sheetId:process.env.MASTER_SHEET_ID||DEFAULT_SHEET_ID,email:clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),privateKey:normalizeKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)};}
export function isJlMasterConfigured(){const c=config();return Boolean(c.sheetId&&c.email&&c.privateKey);}

async function accessToken(){
  const c=config();if(!c.email||!c.privateKey)throw new Error('Google Service Account belum dikonfigurasi.');
  const now=Math.floor(Date.now()/1000),header=b64({alg:'RS256',typ:'JWT'}),payload=b64({iss:c.email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),unsigned=`${header}.${payload}`;
  const signer=crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();const assertion=`${unsigned}.${signer.sign(c.privateKey).toString('base64url')}`;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})}),j=await r.json();if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||'Gagal memperoleh token Google.');return j.access_token;
}

async function readMaster(){
  const c=config(),token=await accessToken(),q=new URLSearchParams({majorDimension:'ROWS',valueRenderOption:'UNFORMATTED_VALUE'});q.append('ranges',"'JL_AIRLINE'!A1:J100");q.append('ranges',"'JL_RATE'!A1:N3000");
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.sheetId)}/values:batchGet?${q}`,{headers:{authorization:`Bearer ${token}`}}),j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Gagal membaca JL Master.');return {sheetId:c.sheetId,airlineRows:j.valueRanges?.[0]?.values||[],rateRows:j.valueRanges?.[1]?.values||[]};
}
function mapRows(rows=[]){const headers=(rows[0]||[]).map(x=>clean(x));return rows.slice(1).filter(r=>r.some(v=>String(v??'').trim()!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));}
function activeOn(row,date){const from=clean(row.effectiveFrom,20),to=clean(row.effectiveTo,20);return upper(row.status)==='ACTIVE'&&(!from||from<=date)&&(!to||to>=date);}

export async function getJlAirlineRateSnapshot(input={}){
  const originHub=upper(input.originHub||'CGK'),destinationCode=upper(input.destinationCode||'DJJ'),airlineId=clean(input.airlineId||'garuda-citilink',100).toLowerCase(),cargoType=upper(input.cargoType||'GENERAL'),date=clean(input.atDate||input.at||new Date().toISOString(),20).slice(0,10);
  const {sheetId,airlineRows,rateRows}=await readMaster(),airlines=mapRows(airlineRows),rates=mapRows(rateRows);
  const airline=airlines.find(x=>clean(x['Airline ID'],100).toLowerCase()===airlineId&&bool(x.Active));if(!airline)throw new Error(`Airline aktif ${airlineId} tidak ditemukan di JL_AIRLINE.`);
  const candidates=rates.filter(x=>upper(x.originHub)===originHub&&clean(x.airlineId,100).toLowerCase()===airlineId&&upper(x.destinationCode)===destinationCode&&(!upper(x.cargoType)||upper(x.cargoType)===cargoType)&&activeOn(x,date));
  if(!candidates.length)throw new Error(`Rate aktif ${originHub}-${destinationCode} untuk ${airlineId}/${cargoType} tidak ditemukan di JL_RATE.`);
  candidates.sort((a,b)=>clean(b.effectiveFrom,20).localeCompare(clean(a.effectiveFrom,20)));const rate=candidates[0];
  const snapshot={
    source:'GOOGLE_SHEET_JL_MASTER',sheetId,capturedAt:new Date().toISOString(),atDate:date,
    rateId:clean(rate.rateId,160),originHub,destinationCode,destinationName:clean(rate.destinationName,120),cargoType,
    airlineId,airlineName:clean(airline['Airline Name'],120),ratePerKg:num(rate.ratePerKg,0),unit:clean(rate.unit,30)||'kg',minKg:num(rate.minKg,num(airline['Minimum kg'],0))||0,adminPerSmu:num(rate.adminPerSmu,num(airline['Admin per SMU'],0))||0,
    effectiveFrom:clean(rate.effectiveFrom,20)||null,effectiveTo:clean(rate.effectiveTo,20)||null,status:upper(rate.status),
    airlineNotes:clean(airline.Notes,600)||null,airlineSource:clean(airline.Source,160)||null,rateSource:clean(rate.source,160)||null,
  };
  if(!(snapshot.ratePerKg>0))throw new Error(`Rate ${snapshot.rateId} tidak memiliki rate/kg valid.`);return snapshot;
}

export async function getPhase1CgkDjjRateSnapshot(input={}){return getJlAirlineRateSnapshot({originHub:'CGK',destinationCode:'DJJ',airlineId:input.airlineId||'garuda-citilink',cargoType:input.cargoType||'GENERAL',atDate:input.atDate});}
