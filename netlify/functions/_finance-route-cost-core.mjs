import crypto from 'node:crypto';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const txt=v=>String(v??'').trim();
function b64(v){return Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');}
function key(){return String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY||'').replace(/\\n/g,'\n').trim();}
async function token(){
 const email=String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL||'').trim(),privateKey=key();if(!email||!privateKey)throw new Error('Google Service Account belum dikonfigurasi.');
 const now=Math.floor(Date.now()/1000),h=b64({alg:'RS256',typ:'JWT'}),p=b64({iss:email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),u=`${h}.${p}`,s=crypto.createSign('RSA-SHA256');s.update(u);s.end();const assertion=`${u}.${s.sign(privateKey).toString('base64url')}`;
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})}),j=await r.json();if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||'Gagal token Google.');return j.access_token;
}
export async function getLiveFinanceRouteCosts(){
 const sheetId=process.env.MASTER_SHEET_ID||DEFAULT_SHEET_ID,t=await token(),q=new URLSearchParams({majorDimension:'ROWS',valueRenderOption:'UNFORMATTED_VALUE'});q.append('ranges',"'Modal Rute Pilot'!A24:AH200");q.append('ranges',"'Modal Rute Pilot'!S8:T18");q.append('ranges',"'Modal Rute Pilot'!B15");
 const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?${q}`,{headers:{authorization:`Bearer ${t}`}}),j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Gagal membaca cost model Finance.');
 const [routeRange,staffRange,contRange]=j.valueRanges||[],rows=routeRange?.values||[],staffRows=staffRange?.values||[],staff=Object.fromEntries(staffRows.filter(x=>x?.[0]).map(x=>[txt(x[0]),n(x[1])])),contingencyPct=n(contRange?.values?.[0]?.[0])||0.1,routes=new Map();
 for(const row of rows.slice(1)){const code=txt(row[0]);if(!code)continue;routes.set(code,{kodeRute:code,tujuan:txt(row[3]),minimumLoadKg:n(row[10]),bbmTrip:n(row[11]),maintenanceTrip:n(row[12]),sdmTrip:n(row[13]),miscTrip:n(row[14]),contingencyTrip:n(row[15]),fullCostTrip:n(row[16]),tripsPerHari:n(row[24]),depresiasiTrip:n(row[30]),pajakAsuransiTrip:n(row[31]),cashOpexTrip:n(row[32]),modelHandlingTrip:n(row[33])});}
 return {routes,contingencyPct,sdmPerDay:staff['Biaya SDM / hari operasi']||0,totalSdmMonthly:staff['Total SDM Operasional / bulan']||0,totalSalaryMonthly:staff['Total Gaji / bulan']||0,driverAllowanceDaily:staff['Total Tunjangan Sopir / hari']||0,staffBreakdown:{driverMonthly:staff['Gaji Kurir/Sopir / bulan']||0,adminMonthly:staff['Gaji Admin / bulan']||0,accountingMonthly:staff['Gaji Akunting/Keuangan / bulan']||0,mealDaily:staff['Uang Makan Sopir / hari']||0,snackDaily:staff['Snack Sopir / hari']||0,cigaretteDaily:staff['Rokok Sopir / hari']||0}};
}
