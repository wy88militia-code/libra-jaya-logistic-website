import crypto from 'node:crypto';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const RANGES={
  config:"'JL_CONFIG'!A1:H300",
  hub:"'JL_HUB'!A1:J500",
  airline:"'JL_AIRLINE'!A1:J200",
  rate:"'JL_RATE'!A1:N3000",
  packing:"'JL_PACKING'!A1:L500",
  agent:"'JL_AGENT'!A1:L1000",
  surcharge:"'JL_SURCHARGE'!A1:H1000",
  vendorMaster:"'VENDOR_MASTER'!A1:H1000",
  vendorRate:"'VENDOR_RATE'!A1:Q5000",
  vendorPrice:"'JL_VENDOR_PRICE'!A1:Q5000",
  lastMileConfirmed:"'Rute Terkonfirmasi'!A1:AO1000",
  lastMileModal:"'Modal Rute Pilot'!A1:AO200",
};
const WRITE_ALLOWED=new Set([RANGES.config,"'JL_AGENT'!A1:G1000",RANGES.packing]);
const clean=v=>String(v??'').trim();
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const privateKey=()=>String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY||'').replace(/\\n/g,'\n').trim();
const sheetId=()=>clean(process.env.MASTER_SHEET_ID)||DEFAULT_SHEET_ID;
const email=()=>clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);

function authorized(request){
  const expected=clean(process.env.JL_SSOT_GATEWAY_TOKEN),auth=clean(request.headers.get('authorization'));
  const got=auth.replace(/^Bearer\s+/i,'');
  if(!expected||!got)return false;
  const a=Buffer.from(expected),b=Buffer.from(got);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function accessToken(scope='https://www.googleapis.com/auth/spreadsheets'){
  const key=privateKey(),mail=email();
  if(!mail||!key)throw new Error('Google Service Account gateway belum dikonfigurasi.');
  const now=Math.floor(Date.now()/1000),head=b64({alg:'RS256',typ:'JWT'}),payload=b64({iss:mail,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),unsigned=`${head}.${payload}`;
  const signer=crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();
  const assertion=`${unsigned}.${signer.sign(key).toString('base64url')}`;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  const j=await r.json();if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||'Token Google gagal.');return j.access_token;
}
async function readAll(){
  const token=await accessToken('https://www.googleapis.com/auth/spreadsheets.readonly'),q=new URLSearchParams({majorDimension:'ROWS',valueRenderOption:'UNFORMATTED_VALUE'});
  Object.values(RANGES).forEach(x=>q.append('ranges',x));
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId())}/values:batchGet?${q}`,{headers:{authorization:`Bearer ${token}`}});
  const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Gagal membaca SSOT JL Express.');
  return Object.fromEntries(Object.keys(RANGES).map((k,i)=>[k,j.valueRanges?.[i]?.values||[]]));
}
function validateWrite(body){
  if(body?.action!=='batch-update')throw new Error('ACTION_NOT_ALLOWED');
  const data=Array.isArray(body.data)?body.data:[],clearRanges=Array.isArray(body.clearRanges)?body.clearRanges:[];
  if(!data.length||data.length>3)throw new Error('INVALID_WRITE_DATA');
  for(const x of data)if(!WRITE_ALLOWED.has(String(x?.range||''))||!Array.isArray(x?.values))throw new Error('RANGE_NOT_ALLOWED');
  for(const x of clearRanges)if(!WRITE_ALLOWED.has(String(x||'')))throw new Error('CLEAR_RANGE_NOT_ALLOWED');
  return {data,clearRanges,source:clean(body.source).slice(0,80)||'JL_SSOT_GATEWAY'};
}
async function writeAll({data,clearRanges,source}){
  const token=await accessToken(),id=sheetId();
  if(clearRanges.length){
    const c=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values:batchClear`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({ranges:clearRanges})});
    if(!c.ok){const j=await c.json().catch(()=>({}));throw new Error(j?.error?.message||'Gagal clear SSOT.');}
  }
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values:batchUpdate`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({valueInputOption:'USER_ENTERED',data})});
  const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Gagal menulis SSOT.');
  const t=new Date().toISOString();
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/'SYSTEM_INTEGRASI'!G3:J3?valueInputOption=USER_ENTERED`,{method:'PUT',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({range:"'SYSTEM_INTEGRASI'!G3:J3",majorDimension:'ROWS',values:[[source,t,'JL Express tersinkron via internal SSOT gateway','GREEN']]})}).catch(()=>{});
  return {ok:true,updatedAt:t,updatedRanges:data.map(x=>x.range)};
}

export default async request=>{
  if(!authorized(request))return Response.json({message:'Unauthorized'},{status:401,headers:{'cache-control':'no-store'}});
  try{
    if(request.method==='GET'){
      const ranges=await readAll();
      return Response.json({ok:true,source:'GOOGLE_SHEET_GATEWAY',sheetId:sheetId(),capturedAt:new Date().toISOString(),ranges},{headers:{'cache-control':'no-store'}});
    }
    if(request.method==='POST'){
      const len=Number(request.headers.get('content-length')||0);if(len>750000)return Response.json({message:'Payload terlalu besar.'},{status:413});
      const body=await request.json();return Response.json(await writeAll(validateWrite(body)),{headers:{'cache-control':'no-store'}});
    }
    return Response.json({message:'Method not allowed'},{status:405});
  }catch(error){
    console.error('JL SSOT gateway error',error);
    return Response.json({message:String(error?.message||error)},{status:502,headers:{'cache-control':'no-store'}});
  }
};
export const config={path:'/.netlify/functions/jl-master-gateway',method:['GET','POST'],rateLimit:{windowSize:60,windowLimit:60,aggregateBy:'ip',action:'rate_limit'}};
