import crypto from 'node:crypto';

const DEFAULT_SHEET_ID='1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k';
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
const upper=v=>clean(v).toUpperCase();
const normalize=v=>clean(v,3000).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
const normalizeKey=v=>String(v||'').replace(/\\n/g,'\n').trim();
const b64=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
const escapeRegExp=v=>String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function config(){return {sheetId:process.env.MASTER_SHEET_ID||DEFAULT_SHEET_ID,email:clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,240),privateKey:normalizeKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)};}
export function isKarantinaMasterConfigured(){const c=config();return Boolean(c.sheetId&&c.email&&c.privateKey);}

async function accessToken(){
  const c=config();if(!c.email||!c.privateKey)throw new Error('Google Service Account Karantina belum dikonfigurasi.');
  const now=Math.floor(Date.now()/1000),header=b64({alg:'RS256',typ:'JWT'}),payload=b64({iss:c.email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}),unsigned=`${header}.${payload}`;
  const signer=crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();const assertion=`${unsigned}.${signer.sign(c.privateKey).toString('base64url')}`;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})}),j=await r.json();if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||'Gagal memperoleh token Google untuk Master Karantina.');return j.access_token;
}

function mapRows(rows=[]){const headers=(rows[0]||[]).map(x=>clean(x,160));return rows.slice(1).filter(r=>r.some(v=>clean(v)!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));}
export async function getKarantinaMasterRules(){
  const c=config(),token=await accessToken(),range="'JL_KARANTINA'!A1:P1000";
  const r=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(c.sheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`,{headers:{authorization:`Bearer ${token}`}}),j=await r.json();
  if(!r.ok)throw new Error(j?.error?.message||'Gagal membaca tab JL_KARANTINA.');
  return {sheetId:c.sheetId,fetchedAt:new Date().toISOString(),rules:mapRows(j.values||[])};
}

function terms(raw=''){
  return clean(raw,1200).split(/[,;\n]+/).flatMap(part=>part.split(/\s*\/\s*/)).map(x=>normalize(x)).filter(x=>x.length>=3&&!['semua','produk','komoditas'].includes(x));
}
function containsTerm(haystack,term){if(!term)return false;const pattern=new RegExp(`(^|[^a-z0-9])${escapeRegExp(term).replace(/\s+/g,'\\s+')}(?=$|[^a-z0-9])`,'i');return pattern.test(haystack);}
function keywordMatch(rule,text){return terms(rule['KOMODITAS / KEYWORD']).some(term=>containsTerm(text,term));}
function isPapua(text){return /(^|[^a-z0-9])(papua|jayapura|sentani|djj)(?=$|[^a-z0-9])/i.test(text);}
function scopeMatch(scopeRaw,value,direction){
  const scope=normalize(scopeRaw),v=normalize(value);if(!scope||scope.includes('semua')||scope.includes('indonesia / internasional')||scope.includes('indonesia')&&scope.includes('internasional'))return true;
  if(scope.includes('antardaerah')||scope.includes('antarpulau'))return true;
  if(scope.includes('luar papua'))return direction==='origin'?!isPapua(v):true;
  if(scope.includes('papua')||scope.includes('jayapura')||scope.includes('sentani'))return isPapua(v);
  return true;
}
function priorityRank(v){const p=upper(v);return p==='CRITICAL'?4:p==='HIGH'?3:p==='MEDIUM'?2:p==='LOW'?1:0;}
function ageDays(dateText){const t=new Date(clean(dateText,30)).getTime();return Number.isFinite(t)&&t>0?Math.floor((Date.now()-t)/86400000):null;}
function publicRule(rule){return {
  ruleId:clean(rule.RULE_ID,80),domain:clean(rule.DOMAIN,80),commodity:clean(rule['KOMODITAS / KEYWORD'],500),condition:clean(rule['KONDISI / VARIAN'],500),status:clean(rule.STATUS_SCREENING,160),requirements:clean(rule['REQUIREMENT / DOKUMEN'],1200),guidance:clean(rule.ACTION_PUTRI,1200),legalBasis:clean(rule['DASAR_HUKUM / KEBIJAKAN'],800),regulationStatus:clean(rule.STATUS_PERATURAN,120),source:clean(rule.SUMBER_RESMI,800),lastVerified:clean(rule.TERAKHIR_DICEK,40),priority:upper(rule.PRIORITAS)||'MEDIUM'
};}

export function screenKarantinaFromRules(input={},rules=[]){
  const commodity=clean(input.commodity||input.contents||input.description||input.goodsDescription,800),cargoType=upper(input.cargoType||''),condition=clean(input.condition||cargoType,300),origin=clean(input.origin||input.originAddress||input.originHub,600),destination=clean(input.destination||input.destinationAddress||input.destinationRegion||input.destinationHub,600);
  const text=normalize(`${commodity} ${condition}`),destPapua=isPapua(normalize(destination));
  const direct=[];const info=[];let internalFreshness=null;
  for(const rule of rules){
    const domain=upper(rule.DOMAIN),ruleId=upper(rule.RULE_ID);
    if(domain==='INTERNAL-JLX'||ruleId==='KAR-OPS-001'){internalFreshness=rule;continue;}
    if(domain==='GENERAL'||ruleId==='KAR-GEN-001')continue;
    if(domain==='TINDAKAN'||ruleId==='KAR-DET-001')continue;
    if(domain==='UPT-PAPUA'||ruleId==='KAR-PAP-PORT-001'){
      if(destPapua&&scopeMatch(rule.TUJUAN_SCOPE,destination,'destination'))info.push(rule);continue;
    }
    if(!scopeMatch(rule.ASAL_SCOPE,origin,'origin')||!scopeMatch(rule.TUJUAN_SCOPE,destination,'destination'))continue;
    if(keywordMatch(rule,text))direct.push(rule);
  }
  if(direct.length){const general=rules.find(r=>upper(r.RULE_ID)==='KAR-GEN-001');if(general)info.unshift(general);}
  const matched=[...direct].sort((a,b)=>priorityRank(b.PRIORITAS)-priorityRank(a.PRIORITAS));
  const primary=matched[0]||null,maxPriority=primary?upper(primary.PRIORITAS):'NONE';
  const requiresReview=matched.length>0;
  const holdRequired=matched.some(r=>{const s=upper(r.STATUS_SCREENING);return s.includes('RESTRICTED')||s.includes('HOLD');});
  const staleHigh=matched.some(r=>priorityRank(r.PRIORITAS)>=3&&((ageDays(r.TERAKHIR_DICEK)??999)>30));
  const freshnessPolicyAge=internalFreshness?ageDays(internalFreshness.TERAKHIR_DICEK):null;
  const requiresLiveVerify=staleHigh||(requiresReview&&freshnessPolicyAge!==null&&freshnessPolicyAge>30&&priorityRank(maxPriority)>=3);
  const domains=[...new Set(matched.map(r=>upper(r.DOMAIN)))];
  const classification=domains.some(d=>d.includes('HEWAN'))?'KARANTINA_HEWAN':domains.some(d=>d.includes('IKAN'))?'KARANTINA_IKAN':domains.some(d=>d.includes('TUMBUHAN'))?'KARANTINA_TUMBUHAN':'NONE';
  const status=holdRequired?'HOLD_REQUIRED':requiresLiveVerify?'LIVE_VERIFY_REQUIRED':requiresReview?'REVIEW_REQUIRED':'NO_MATCH';
  return {
    ok:true,status,classification,requiresReview,holdRequired,requiresLiveVerify,destinationPapua:destPapua,priority:maxPriority,
    input:{commodity,cargoType,condition,origin,destination},
    matchedRules:matched.map(publicRule),contextRules:info.map(publicRule),
    checkedAt:new Date().toISOString(),disclaimer:'Screening awal JL Express. Keputusan karantina final mengikuti aturan terbaru dan pejabat/UPT Karantina yang berwenang.'
  };
}

export async function screenKarantina(input={}){const master=await getKarantinaMasterRules();return {...screenKarantinaFromRules(input,master.rules),source:'MASTER_DATA_LIBRA_JAYA_LOGISTIC_SISTEM/JL_KARANTINA',sheetId:master.sheetId,masterFetchedAt:master.fetchedAt,ruleCount:master.rules.length};}
