import crypto from 'node:crypto';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const SHEET_NAME='Jarak Bandara-Kelurahan';
const clean=v=>String(v??'').trim();
const normalize=v=>clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const privateKey=v=>clean(v).replace(/\\n/g,'\n');

export const PILOT_ROUTE_CODES=[
 'LM-DJJ-9103-01-1002','LM-DJJ-9103-01-1003','LM-DJJ-9103-01-1001',
 'LM-DJJ-9103-04-3006','LM-DJJ-9103-04-2001','LM-DJJ-9103-04-2005','LM-DJJ-9103-04-2011','LM-DJJ-9103-04-2008',
 'LM-DJJ-9103-02-2004','LM-DJJ-9103-02-3003','LM-DJJ-9103-02-3005','LM-DJJ-9103-02-3007','LM-DJJ-9103-02-2006','LM-DJJ-9103-02-2001','LM-DJJ-9103-02-2002',
 'LM-DJJ-9171-05-1001','LM-DJJ-9171-05-1002','LM-DJJ-9171-05-1004',
 'LM-DJJ-9171-03-1011','LM-DJJ-9171-03-1002','LM-DJJ-9171-03-1008','LM-DJJ-9171-03-1012','LM-DJJ-9171-03-1014','LM-DJJ-9171-03-1015','LM-DJJ-9171-03-1016','LM-DJJ-9171-03-1010',
 'LM-DJJ-9171-02-1002','LM-DJJ-9171-02-1001','LM-DJJ-9171-02-1005','LM-DJJ-9171-02-1006','LM-DJJ-9171-02-1003',
 'LM-DJJ-9171-01-1007','LM-DJJ-9171-01-1002','LM-DJJ-9171-01-1001','LM-DJJ-9171-01-1004','LM-DJJ-9171-01-1006','LM-DJJ-9171-01-1005','LM-DJJ-9171-01-1003',
 'LM-DJJ-9171-04-1004','LM-DJJ-9171-04-1005',
 'LM-DJJ-9111-02-2001',
];
const PILOT_SET=new Set(PILOT_ROUTE_CODES);

function config(){return {
 sheetId:clean(process.env.MASTER_SHEET_ID)||DEFAULT_SHEET_ID,
 serviceEmail:clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
 privateKey:privateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
 mapsKey:clean(process.env.GOOGLE_MAPS_SERVER_API_KEY),
};}
function b64(v){return Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');}

async function sheetsToken(){
 const c=config();if(!c.serviceEmail||!c.privateKey)throw new Error('Google Service Account belum dikonfigurasi.');
 const now=Math.floor(Date.now()/1000),header=b64({alg:'RS256',typ:'JWT'}),payload=b64({iss:c.serviceEmail,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const unsigned=`${header}.${payload}`;const signer=crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();
 const assertion=`${unsigned}.${signer.sign(c.privateKey).toString('base64url')}`;
 const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 const body=await res.json();if(!res.ok||!body.access_token)throw new Error(body.error_description||body.error||'Gagal memperoleh token Google Sheets.');return body.access_token;
}

async function readPilotRows(token){
 const c=config();const range=encodeURIComponent(`'${SHEET_NAME}'!A1:AJ1000`);
 const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.sheetId)}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,{headers:{authorization:`Bearer ${token}`}});
 const body=await res.json();if(!res.ok)throw new Error(body?.error?.message||'Gagal membaca sheet rute pilot.');
 return (body.values||[]).slice(1).map((row,i)=>({rowNumber:i+2,kodeRute:clean(row[0]),provinsi:clean(row[4]),kabupatenKota:clean(row[5]),distrik:clean(row[6]),kelurahan:clean(row[7]),kodeWilayah:clean(row[8]),query:clean(row[9])})).filter(r=>PILOT_SET.has(r.kodeRute));
}

function placeToken(v){return normalize(v).replace(/\b(kabupaten|kota|distrik|kecamatan|kelurahan|kampung|provinsi|desa adat|desa)\b/g,' ').replace(/\s+/g,' ').trim();}
function resultScore(result,row){
 const hay=normalize([result.formatted_address,...(result.address_components||[]).flatMap(c=>[c.long_name,c.short_name])].join(' '));
 const village=placeToken(row.kelurahan),district=placeToken(row.distrik),city=placeToken(row.kabupatenKota),province=placeToken(row.provinsi);
 let score=0;if(village&&hay.includes(village))score+=6;if(district&&hay.includes(district))score+=2;if(city&&hay.includes(city))score+=2;if(province&&hay.includes(province))score+=1;return score;
}

async function geocode(row){
 const key=config().mapsKey;if(key.length<20)throw new Error('GOOGLE_MAPS_SERVER_API_KEY belum dikonfigurasi.');
 const query=row.query||[row.kelurahan,`Distrik ${row.distrik}`,row.kabupatenKota,row.provinsi,'Indonesia'].filter(Boolean).join(', ');
 const url=new URL('https://maps.googleapis.com/maps/api/geocode/json');url.searchParams.set('address',query);url.searchParams.set('language','id');url.searchParams.set('region','id');url.searchParams.set('key',key);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const res=await fetch(url,{signal:controller.signal});const body=await res.json();if(!res.ok)throw new Error(body?.error_message||`Google Maps HTTP ${res.status}`);if(body.status!=='OK'||!body.results?.length)throw new Error(body.error_message||body.status||'Tidak ada hasil Google');
  const ranked=body.results.map(r=>({r,score:resultScore(r,row)})).sort((a,b)=>b.score-a.score);const best=ranked[0];
  const lat=Number(best.r.geometry?.location?.lat),lng=Number(best.r.geometry?.location?.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error('Koordinat Google tidak valid.');
  if(best.score<4)throw new Error(`LOW CONFIDENCE (${best.score}) — ${best.r.formatted_address||query}`);
  const locationType=clean(best.r.geometry?.location_type)||'UNKNOWN';const partial=best.r.partial_match?'PARTIAL MATCH':'MATCH';
  return {...row,ok:true,latitude:lat,longitude:lng,address:clean(best.r.formatted_address),status:`GOOGLE API PASS - ${partial} - ${locationType}`,score:best.score};
 }finally{clearTimeout(timer);}
}

async function mapLimit(items,limit,fn){
 const out=new Array(items.length);let cursor=0;
 async function worker(){while(true){const i=cursor++;if(i>=items.length)return;try{out[i]=await fn(items[i]);}catch(e){out[i]={...items[i],ok:false,error:clean(e.message)||'Geocoding gagal'};}}}
 await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out;
}
function witDate(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}

async function writeResults(token,results){
 const c=config(),date=witDate(),data=[];
 for(const r of results){
  if(r.ok)data.push({range:`'${SHEET_NAME}'!AE${r.rowNumber}:AJ${r.rowNumber}`,majorDimension:'ROWS',values:[[r.latitude,r.longitude,'Google Maps Geocoding API',r.status,date,r.address]]});
  else data.push({range:`'${SHEET_NAME}'!AG${r.rowNumber}:AJ${r.rowNumber}`,majorDimension:'ROWS',values:[['Google Maps Geocoding API',`GOOGLE API GAGAL - ${clean(r.error).slice(0,180)}`,date,'']]});
 }
 if(!data.length)return;
 const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.sheetId)}/values:batchUpdate`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({valueInputOption:'RAW',data})});
 const body=await res.json();if(!res.ok)throw new Error(body?.error?.message||'Gagal menulis hasil geocoding ke Google Sheet.');
}

export async function generatePilotCoordinates(){
 const token=await sheetsToken(),rows=await readPilotRows(token);if(rows.length!==PILOT_ROUTE_CODES.length)throw new Error(`Rute pilot di Sheet tidak lengkap: ditemukan ${rows.length}/${PILOT_ROUTE_CODES.length}.`);
 const results=await mapLimit(rows,5,geocode);await writeResults(token,results);
 const success=results.filter(r=>r.ok),failed=results.filter(r=>!r.ok);
 return {generatedAt:new Date().toISOString(),total:results.length,success:success.length,failed:failed.length,results};
}
