import crypto from 'node:crypto';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const SHEET='Jarak Bandara-Kelurahan';
const clean=v=>String(v??'').trim();
const key=v=>clean(v).replace(/\\n/g,'\n');
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
function config(){return {sheetId:clean(process.env.MASTER_SHEET_ID)||DEFAULT_SHEET_ID,email:clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),privateKey:key(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)};}
async function accessToken(){const c=config();if(!c.email||!c.privateKey)throw new Error('Google Service Account belum dikonfigurasi.');const now=Math.floor(Date.now()/1000),h=b64({alg:'RS256',typ:'JWT'}),p=b64({iss:c.email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),u=`${h}.${p}`,s=crypto.createSign('RSA-SHA256');s.update(u);s.end();const assertion=`${u}.${s.sign(c.privateKey).toString('base64url')}`;const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})}),body=await r.json();if(!r.ok||!body.access_token)throw new Error(body.error_description||body.error||'Token Google Sheets gagal.');return body.access_token;}
function witDate(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
async function routeRows(token){const c=config(),range=encodeURIComponent(`'${SHEET}'!A1:AD1000`),r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.sheetId)}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,{headers:{authorization:`Bearer ${token}`}}),body=await r.json();if(!r.ok)throw new Error(body?.error?.message||'Gagal membaca row Master untuk write-back.');const map=new Map();(body.values||[]).slice(1).forEach((row,i)=>{const code=clean(row[0]);if(code)map.set(code,i+2);});return map;}

export async function writeBackPilotMaster(snapshot){
 if(!snapshot?.routes?.length)return {updated:0,skipped:0};const token=await accessToken(),rows=await routeRows(token),date=witDate(),data=[];let skipped=0;
 for(const r of snapshot.routes){
  if(!r.statusPilot&&!r.grupModal)continue;const row=rows.get(r.kodeRute);if(!row){skipped++;continue;}
  const source='AUTO MASTER PILOT / GOOGLE MAPS';
  if(r.requiresOperationalConfirmation){
   data.push({range:`'${SHEET}'!M${row}:N${row}`,majorDimension:'ROWS',values:[['PERLU KONFIRMASI OPERASIONAL','PERLU KONFIRMASI']]});
   data.push({range:`'${SHEET}'!P${row}:Q${row}`,majorDimension:'ROWS',values:[[date,source]]});
   data.push({range:`'${SHEET}'!AA${row}:AD${row}`,majorDimension:'ROWS',values:[['ON REQUEST','',r.titikMulaiSla||'SEJAK BARANG DITERIMA','BELUM AKTIF']]});
   continue;
  }
  if(r.autoPilotActive){
   data.push({range:`'${SHEET}'!M${row}:N${row}`,majorDimension:'ROWS',values:[[r.statusVerifikasi||'TERVERIFIKASI GOOGLE ROUTES',r.jenisAkses||'DARAT']]});
   data.push({range:`'${SHEET}'!P${row}:Q${row}`,majorDimension:'ROWS',values:[[date,source]]});
   data.push({range:`'${SHEET}'!S${row}:Y${row}`,majorDimension:'ROWS',values:[[r.prosesHubJam||4,r.bufferOperasionalJam||'',r.slaLastmile||'',r.slaTotalHub||'',r.statusSla||'AUTO PILOT - AKTIF',r.dasarSla||'Google Routes + proses hub + buffer operasional',date]]});
   data.push({range:`'${SHEET}'!AA${row}:AD${row}`,majorDimension:'ROWS',values:[[r.skemaLayanan||'REGULER',Number(r.minimumLoadKg)||'',r.titikMulaiSla||'SEJAK BARANG DITERIMA','AKTIF']]});
   continue;
  }
  data.push({range:`'${SHEET}'!M${row}:N${row}`,majorDimension:'ROWS',values:[['PILOT - MENUNGGU GOOGLE ROUTES','PERLU VERIFIKASI']]});
  data.push({range:`'${SHEET}'!P${row}:Q${row}`,majorDimension:'ROWS',values:[[date,source]]});
  data.push({range:`'${SHEET}'!AA${row}:AD${row}`,majorDimension:'ROWS',values:[['REGULER',Number(r.minimumLoadKg)||'',r.titikMulaiSla||'SEJAK BARANG DITERIMA','BELUM AKTIF']]});
 }
 if(!data.length)return {updated:0,skipped};const c=config(),resp=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.sheetId)}/values:batchUpdate`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({valueInputOption:'RAW',data})}),body=await resp.json();if(!resp.ok)throw new Error(body?.error?.message||'Write-back Master pilot gagal.');return {updated:data.length,routeCount:new Set(data.map(x=>(x.range.match(/\d+/)||[])[0])).size,skipped};
}
